import fs from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('@mediadillo/db', () => ({
  prisma: {
    movie: { findUnique: vi.fn(), findMany: vi.fn() },
    movieFile: { deleteMany: vi.fn(), create: vi.fn() },
  },
}))
vi.mock('../activity/log.js', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))

import { spawn } from 'node:child_process'
import { prisma } from '@mediadillo/db'
import { mergeMovieParts, retirePartSidecars } from './merge.js'

const mockSpawn = vi.mocked(spawn)
const mockMovie = prisma.movie as unknown as { findUnique: ReturnType<typeof vi.fn> }
const mockMovieFile = prisma.movieFile as unknown as {
  deleteMany: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}

const tmpRoot = path.join(process.cwd(), 'tmp', 'merge-test')

beforeAll(async () => {
  await fs.mkdir(tmpRoot, { recursive: true })
})

/**
 * Stands in for one ffprobe/ffmpeg process. `stdout` is what the command prints;
 * `code` is its exit status.
 */
function fakeProc(stdout: string, code = 0) {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  setImmediate(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout))
    proc.emit('close', code)
  })
  return proc
}

const STREAMS = JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
    { codec_type: 'audio', codec_name: 'ac3', channels: 6 },
  ],
})

/**
 * Routes each spawn to a canned result. probeMedia issues two ffprobe calls per file —
 * one for the streams, one for the last packet's pts_time — so the duration is keyed on
 * the file path and the stream list is the same for every part.
 */
function stubFfmpeg(durationsByPath: Record<string, number>, ffmpegExit = 0) {
  mockSpawn.mockImplementation(((cmd: string, args: string[]) => {
    if (cmd === 'ffmpeg') return fakeProc('', ffmpegExit)
    const file = args[args.length - 1]!
    if (args.includes('packet=pts_time')) {
      const d = durationsByPath[file]
      return fakeProc(d === undefined ? '' : `${d}\n`)
    }
    return fakeProc(durationsByPath[file] === undefined ? '' : STREAMS)
  }) as unknown as typeof spawn)
}

describe('retirePartSidecars (issue #79)', () => {
  let dir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    dir = await fs.mkdtemp(path.join(tmpRoot, path.sep))
  })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  it("trashes both parts' sidecars and leaves the folder-level ones", async () => {
    const p1 = path.join(dir, 'Il Gattopardo (1963) - part1.mkv')
    const p2 = path.join(dir, 'Il Gattopardo (1963) - part2.mkv')
    for (const n of [
      'Il Gattopardo (1963) - part1.mkv',
      'Il Gattopardo (1963) - part1.nfo',
      'Il Gattopardo (1963) - part2.mkv',
      'Il Gattopardo (1963) - part2.nfo',
      'Il Gattopardo (1963) - part2.eng.srt',
      'movie.nfo',
      'poster.jpg',
    ]) await fs.writeFile(path.join(dir, n), 'x')

    const retired = await retirePartSidecars([p1, p2])

    expect(retired.map((r) => path.basename(r)).sort()).toEqual([
      'Il Gattopardo (1963) - part1.nfo',
      'Il Gattopardo (1963) - part2.eng.srt',
      'Il Gattopardo (1963) - part2.nfo',
    ])
    // The part videos are retired by the caller, so they are still in place here.
    expect((await fs.readdir(dir)).sort()).toEqual([
      '.trash',
      'Il Gattopardo (1963) - part1.mkv',
      'Il Gattopardo (1963) - part2.mkv',
      'movie.nfo',
      'poster.jpg',
    ])
    expect(await fs.readdir(path.join(dir, '.trash'))).toHaveLength(3)
  })

  it('returns an empty list when the parts have no sidecars', async () => {
    const p1 = path.join(dir, 'Movie - cd1.mkv')
    await fs.writeFile(p1, 'x')
    await fs.writeFile(path.join(dir, 'poster.jpg'), 'x')
    expect(await retirePartSidecars([p1])).toEqual([])
    expect((await fs.readdir(dir)).sort()).toEqual(['Movie - cd1.mkv', 'poster.jpg'])
  })

  it('skips a part whose folder cannot be read instead of throwing', async () => {
    expect(await retirePartSidecars([path.join(dir, 'gone', 'Movie - cd1.mkv')])).toEqual([])
  })
})

describe('mergeMovieParts — sidecar retirement is gated on verification (issue #79)', () => {
  let root: string
  let folder: string
  let p1: string
  let p2: string

  const HALF = 50 * 60

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await fs.mkdtemp(path.join(tmpRoot, path.sep))
    folder = path.join(root, 'Il Gattopardo (1963)')
    await fs.mkdir(folder, { recursive: true })
    p1 = path.join(folder, 'Il Gattopardo (1963) - part1.mkv')
    p2 = path.join(folder, 'Il Gattopardo (1963) - part2.mkv')
    for (const n of [
      'Il Gattopardo (1963) - part1.mkv',
      'Il Gattopardo (1963) - part1.nfo',
      'Il Gattopardo (1963) - part2.mkv',
      'Il Gattopardo (1963) - part2.nfo',
      'movie.nfo',
      'poster.jpg',
    ]) await fs.writeFile(path.join(folder, n), 'x')

    mockMovie.findUnique.mockResolvedValue({
      id: 'movie-1',
      title: 'Il Gattopardo',
      year: 1963,
      runtime: 100,
      scanRoot: { id: 'root-1', path: root },
      files: [
        { id: 'f1', path: p1, sizeBytes: BigInt(1000) },
        { id: 'f2', path: p2, sizeBytes: BigInt(1000) },
      ],
    })
    mockMovieFile.create.mockResolvedValue({})
    mockMovieFile.deleteMany.mockResolvedValue({ count: 2 })
  })
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

  it('retires the part sidecars once the merged output verifies', async () => {
    const out = path.join(folder, 'Il Gattopardo (1963).mkv')
    stubFfmpeg({ [p1]: HALF, [p2]: HALF, [out]: HALF * 2 })

    const result = await mergeMovieParts('movie-1')

    expect(result).toEqual({ outputPath: out })
    // ffmpeg is stubbed, so the merged file is never actually written — what is under
    // test is which originals get retired, and that all four land in one .trash.
    const left = await fs.readdir(folder)
    expect(left.filter((n) => n.includes('part')).sort()).toEqual([])
    expect(left.sort()).toEqual(['.trash', 'movie.nfo', 'poster.jpg'])
    expect((await fs.readdir(path.join(folder, '.trash'))).length).toBe(4)
  })

  it('leaves every sidecar in place when verification fails', async () => {
    // A merged file only as long as one part means -c copy dropped the second.
    // Nothing may be retired, or the originals are gone and the output is wrong.
    const out = path.join(folder, 'Il Gattopardo (1963).mkv')
    stubFfmpeg({ [p1]: HALF, [p2]: HALF, [out]: HALF })

    const result = await mergeMovieParts('movie-1')

    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('originals left untouched')
    expect((await fs.readdir(folder)).sort()).toEqual([
      'Il Gattopardo (1963) - part1.mkv',
      'Il Gattopardo (1963) - part1.nfo',
      'Il Gattopardo (1963) - part2.mkv',
      'Il Gattopardo (1963) - part2.nfo',
      'movie.nfo',
      'poster.jpg',
    ])
    expect(mockMovieFile.deleteMany).not.toHaveBeenCalled()
  })

  it('leaves every sidecar in place when the parts are not mergeable at all', async () => {
    // Two different cuts of the same film, not two halves of one.
    stubFfmpeg({ [p1]: 127.7 * 60, [p2]: 135.6 * 60 })

    const result = await mergeMovieParts('movie-1')

    expect(result).toHaveProperty('error')
    expect((await fs.readdir(folder)).filter((n) => n.includes('part')).length).toBe(4)
  })
})

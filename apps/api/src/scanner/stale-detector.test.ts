import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectStaleFiles } from './stale-detector.js'
import * as walker from './walker.js'

vi.mock('./walker.js')

const mockList = (files: string[]) => {
  vi.mocked(walker.listFolderFiles).mockResolvedValue(files)
}

describe('detectStaleFiles', () => {
  const folder = '/mnt/nas/film/Movie (2020)'

  beforeEach(() => vi.clearAllMocks())

  it('returns empty when only known files present', async () => {
    mockList([
      `${folder}/Movie (2020).mkv`,
      `${folder}/poster.jpg`,
      `${folder}/backdrop.jpg`,
      `${folder}/movie.nfo`,
    ])
    const knownVideos = new Set([`${folder}/Movie (2020).mkv`])
    const stale = await detectStaleFiles(folder, knownVideos)
    expect(stale).toHaveLength(0)
  })

  it('flags .tbn file as stale', async () => {
    mockList([`${folder}/Movie (2020).mkv`, `${folder}/movie.tbn`])
    const knownVideos = new Set([`${folder}/Movie (2020).mkv`])
    const stale = await detectStaleFiles(folder, knownVideos)
    expect(stale).toHaveLength(1)
    expect(stale[0]?.path).toContain('movie.tbn')
  })

  it('flags .xml metadata file as stale', async () => {
    mockList([`${folder}/Movie.xml`])
    const stale = await detectStaleFiles(folder, new Set())
    expect(stale.some((s) => s.path.endsWith('.xml'))).toBe(true)
  })

  it('does not flag subtitle files', async () => {
    mockList([`${folder}/Movie (2020).srt`, `${folder}/Movie (2020).mkv`])
    const knownVideos = new Set([`${folder}/Movie (2020).mkv`])
    const stale = await detectStaleFiles(folder, knownVideos)
    expect(stale).toHaveLength(0)
  })

  it('flags orphaned video file not in library', async () => {
    mockList([`${folder}/Movie.old.avi`])
    const stale = await detectStaleFiles(folder, new Set())
    expect(stale[0]?.reason).toContain('not in library')
  })
})

describe('detectStaleFiles — subtitle formats (issue #71)', () => {
  const folder = '/mnt/nas/film/Movie (2020)'
  const video = `${folder}/Movie (2020).mkv`

  beforeEach(() => vi.clearAllMocks())

  it('never flags a subtitle sidecar as stale, in any format', async () => {
    // A format missing from SUBTITLE_EXTENSIONS falls through every branch to
    // "unrecognized file", so MediaDillo would offer to delete a real subtitle.
    // .sup is the one that bit us: four PGS tracks had to be rescued by hand.
    const exts = ['.srt', '.sub', '.idx', '.sup', '.ass', '.ssa', '.vtt', '.mks']
    mockList([video, ...exts.map((e) => `${folder}/Movie (2020).eng${e}`)])
    const stale = await detectStaleFiles(folder, new Set([video]))
    expect(stale.map((s) => s.path)).toEqual([])
  })

  it('flags a genuinely unrecognised file even alongside subtitles', async () => {
    // Guard against the fix being over-broad: widening the subtitle set must not
    // make the detector blind.
    mockList([video, `${folder}/Movie (2020).eng.sup`, `${folder}/mystery.bin`])
    const stale = await detectStaleFiles(folder, new Set([video]))
    expect(stale).toHaveLength(1)
    expect(stale[0]?.path).toContain('mystery.bin')
  })
})

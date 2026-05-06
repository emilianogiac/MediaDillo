import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all collaborators before importing the module under test
vi.mock('./walker.js', () => ({ walkRoot: vi.fn() }))
vi.mock('./filename-parser.js', () => ({ parseFilename: vi.fn() }))
vi.mock('./ffprobe.js', () => ({ extractTechSpecs: vi.fn() }))
vi.mock('./stale-detector.js', () => ({ detectStaleFiles: vi.fn() }))
vi.mock('./db-sync.js', () => ({
  syncMovieFile: vi.fn(),
  syncEpisodeFile: vi.fn(),
  writeScanLog: vi.fn(),
}))
vi.mock('@mediadillo/db', () => ({
  prisma: {
    scanRoot: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

import { runScan } from './index.js'
import { walkRoot } from './walker.js'
import { parseFilename } from './filename-parser.js'
import { extractTechSpecs } from './ffprobe.js'
import { detectStaleFiles } from './stale-detector.js'
import { syncMovieFile, syncEpisodeFile, writeScanLog } from './db-sync.js'
import { prisma } from '@mediadillo/db'

const mockWalkRoot = vi.mocked(walkRoot)
const mockParseFilename = vi.mocked(parseFilename)
const mockExtractTechSpecs = vi.mocked(extractTechSpecs)
const mockDetectStaleFiles = vi.mocked(detectStaleFiles)
const mockSyncMovieFile = vi.mocked(syncMovieFile)
const mockSyncEpisodeFile = vi.mocked(syncEpisodeFile)
const mockWriteScanLog = vi.mocked(writeScanLog)
const mockScanRoot = prisma.scanRoot as unknown as {
  findFirst: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}

const FAKE_SCAN_ROOT = { id: 'root-1', path: '/mnt/nas', label: 'NAS', type: 'movies' as const }

const FAKE_TECH_SPECS = {
  videoCodec: 'H.264',
  videoResolution: '1080p',
  videoQualityTier: '1080p',
  hdr: false,
  audioCodec: 'AAC',
  audioChannels: '2.0',
  audioQualityTier: 'stereo',
}

function makeWalkedFile(filePath: string) {
  return {
    path: filePath,
    parentFolder: '',
    sizeBytes: BigInt(1_000_000_000),
    mtimeMs: Date.now(),
  }
}

async function* asyncOf<T>(...items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item
}

beforeEach(() => {
  vi.clearAllMocks()
  mockScanRoot.findFirst.mockResolvedValue(FAKE_SCAN_ROOT)
  mockScanRoot.create.mockResolvedValue(FAKE_SCAN_ROOT)
  mockExtractTechSpecs.mockResolvedValue(FAKE_TECH_SPECS)
  mockDetectStaleFiles.mockResolvedValue([])
  mockWriteScanLog.mockResolvedValue('log-1')
  mockSyncMovieFile.mockResolvedValue('added')
  mockSyncEpisodeFile.mockResolvedValue('added')
})

describe('runScan — scan root type routing', () => {
  it('routes a parser-classified movie to syncMovieFile when scan root is movies', async () => {
    const filePath = '/mnt/nas/The Godfather (1972)/The Godfather (1972).mkv'
    mockWalkRoot.mockReturnValue(asyncOf(makeWalkedFile(filePath)))
    mockParseFilename.mockReturnValue({ type: 'movie', title: 'The Godfather', year: 1972 })

    await runScan([{ path: '/mnt/nas', label: 'Movies', type: 'movies' }])

    expect(mockSyncMovieFile).toHaveBeenCalledOnce()
    expect(mockSyncEpisodeFile).not.toHaveBeenCalled()
  })

  it('routes a parser-classified TV episode to syncEpisodeFile when scan root is tv', async () => {
    const filePath = '/mnt/nas/tv/Breaking Bad/Season 01/Breaking Bad - S01E01.mkv'
    mockWalkRoot.mockReturnValue(asyncOf(makeWalkedFile(filePath)))
    mockParseFilename.mockReturnValue({
      type: 'tv',
      show: 'Breaking Bad',
      year: null,
      season: 1,
      episodes: [1],
      episodeTitle: 'Pilot',
    })

    await runScan([{ path: '/mnt/nas/tv', label: 'TV', type: 'tv' }])

    expect(mockSyncEpisodeFile).toHaveBeenCalledOnce()
    expect(mockSyncMovieFile).not.toHaveBeenCalled()
  })

  it('skips (does NOT call syncMovieFile) a file in a TV root that the parser misclassifies as a movie', async () => {
    // File has no S/E pattern → parser calls it a movie, but the root is tv
    const filePath = '/mnt/nas/tv/Breaking Bad/Season 01/Breaking Bad - Pilot.mkv'
    mockWalkRoot.mockReturnValue(asyncOf(makeWalkedFile(filePath)))
    mockParseFilename.mockReturnValue({ type: 'movie', title: 'Breaking Bad - Pilot', year: null })

    await runScan([{ path: '/mnt/nas/tv', label: 'TV', type: 'tv' }])

    // Must not land in the Movie table
    expect(mockSyncMovieFile).not.toHaveBeenCalled()
    expect(mockSyncEpisodeFile).not.toHaveBeenCalled()
  })

  it('skips a parser-classified TV file that ends up in a movies root', async () => {
    // Shouldn't happen in practice, but guard against it symmetrically
    const filePath = '/mnt/nas/movies/Show.S01E01.mkv'
    mockWalkRoot.mockReturnValue(asyncOf(makeWalkedFile(filePath)))
    mockParseFilename.mockReturnValue({
      type: 'tv',
      show: 'Show',
      year: null,
      season: 1,
      episodes: [1],
      episodeTitle: null,
    })

    await runScan([{ path: '/mnt/nas/movies', label: 'Movies', type: 'movies' }])

    expect(mockSyncMovieFile).not.toHaveBeenCalled()
    expect(mockSyncEpisodeFile).not.toHaveBeenCalled()
  })

  it('counts added files correctly across a mixed-valid TV scan', async () => {
    const ep1 = '/mnt/nas/tv/Breaking Bad/Season 01/Breaking Bad - S01E01.mkv'
    const ep2 = '/mnt/nas/tv/Breaking Bad/Season 01/Breaking Bad - S01E02.mkv'
    const unrecognised = '/mnt/nas/tv/Breaking Bad/Season 01/Featurette.mkv'

    mockWalkRoot.mockReturnValue(asyncOf(
      makeWalkedFile(ep1),
      makeWalkedFile(ep2),
      makeWalkedFile(unrecognised),
    ))
    mockParseFilename
      .mockReturnValueOnce({ type: 'tv', show: 'Breaking Bad', year: null, season: 1, episodes: [1], episodeTitle: 'Pilot' })
      .mockReturnValueOnce({ type: 'tv', show: 'Breaking Bad', year: null, season: 1, episodes: [2], episodeTitle: 'Cat\'s in the Bag' })
      .mockReturnValueOnce({ type: 'movie', title: 'Featurette', year: null }) // misclassified

    mockSyncEpisodeFile.mockResolvedValue('added')

    const summary = await runScan([{ path: '/mnt/nas/tv', label: 'TV', type: 'tv' }])

    expect(mockSyncEpisodeFile).toHaveBeenCalledTimes(2)
    expect(mockSyncMovieFile).not.toHaveBeenCalled()
    expect(summary.filesAdded).toBe(2)
  })
})

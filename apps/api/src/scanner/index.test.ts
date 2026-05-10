import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all collaborators before importing the module under test
vi.mock('./walker.js', () => ({ walkRoot: vi.fn(), walkMovieFolders: vi.fn() }))
vi.mock('./filename-parser.js', () => ({ parseFilename: vi.fn() }))
vi.mock('./ffprobe.js', () => ({ extractTechSpecs: vi.fn() }))
vi.mock('./stale-detector.js', () => ({ detectStaleFiles: vi.fn() }))
vi.mock('./db-sync.js', () => ({
  syncMovieFile: vi.fn(),
  syncEpisodeFile: vi.fn(),
  syncMovieFolder: vi.fn(),
  pruneOrphanedFiles: vi.fn(),
  writeScanLog: vi.fn(),
}))
vi.mock('@mediadillo/db', () => ({
  prisma: {
    scanRoot: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

import { runScan } from './index.js'
import { walkRoot, walkMovieFolders } from './walker.js'
import { parseFilename } from './filename-parser.js'
import { extractTechSpecs } from './ffprobe.js'
import { detectStaleFiles } from './stale-detector.js'
import { syncMovieFile, syncEpisodeFile, syncMovieFolder, pruneOrphanedFiles, writeScanLog } from './db-sync.js'
import { prisma } from '@mediadillo/db'

const mockWalkRoot = vi.mocked(walkRoot)
const mockWalkMovieFolders = vi.mocked(walkMovieFolders)
const mockParseFilename = vi.mocked(parseFilename)
const mockExtractTechSpecs = vi.mocked(extractTechSpecs)
const mockDetectStaleFiles = vi.mocked(detectStaleFiles)
const mockSyncMovieFile = vi.mocked(syncMovieFile)
const mockSyncMovieFolder = vi.mocked(syncMovieFolder)
const mockPruneOrphanedFiles = vi.mocked(pruneOrphanedFiles)
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
  mockSyncMovieFolder.mockResolvedValue({ added: 0, changed: 0, removed: 0 })
  mockPruneOrphanedFiles.mockResolvedValue(0)
  mockSyncEpisodeFile.mockResolvedValue('added')
  mockWalkMovieFolders.mockReturnValue(asyncOf())
})

describe('runScan — scan root type routing', () => {
  it('calls syncMovieFolder (not syncEpisodeFile) for a movies root', async () => {
    const folderPath = '/mnt/nas/The Godfather (1972)'
    const file = makeWalkedFile('/mnt/nas/The Godfather (1972)/The Godfather (1972).mkv')
    mockWalkMovieFolders.mockReturnValue(asyncOf({ folderPath, files: [file] }))
    mockSyncMovieFolder.mockResolvedValue({ added: 1, changed: 0, removed: 0 })

    const summary = await runScan([{ path: '/mnt/nas', label: 'Movies', type: 'movies' }])

    expect(mockSyncMovieFolder).toHaveBeenCalledOnce()
    expect(mockSyncEpisodeFile).not.toHaveBeenCalled()
    expect(summary.filesAdded).toBe(1)
  })

  it('routes a TV episode to syncEpisodeFile when scan root is tv', async () => {
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

  it('skips a file in a TV root that the parser cannot classify as TV', async () => {
    // File has no S/E pattern → parser returns movie type, TV root skips it
    const filePath = '/mnt/nas/tv/Breaking Bad/Season 01/Breaking Bad - Pilot.mkv'
    mockWalkRoot.mockReturnValue(asyncOf(makeWalkedFile(filePath)))
    mockParseFilename.mockReturnValue({ type: 'movie', title: 'Breaking Bad - Pilot', year: null, edition: null })

    await runScan([{ path: '/mnt/nas/tv', label: 'TV', type: 'tv' }])

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
      .mockReturnValueOnce({ type: 'movie', title: 'Featurette', year: null, edition: null }) // no S/E pattern → skipped

    mockSyncEpisodeFile.mockResolvedValue('added')

    const summary = await runScan([{ path: '/mnt/nas/tv', label: 'TV', type: 'tv' }])

    expect(mockSyncEpisodeFile).toHaveBeenCalledTimes(2)
    expect(mockSyncMovieFile).not.toHaveBeenCalled()
    expect(summary.filesAdded).toBe(2)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

// All collaborators must be mocked before importing the module under test
vi.mock('./artwork-detector.js', () => ({ detectLocalArtwork: vi.fn() }))
vi.mock('./nfo-parser.js', () => ({
  parseMovieNfo: vi.fn(),
  parseShowNfo: vi.fn(),
  parseEpisodeNfo: vi.fn(),
}))
vi.mock('./filename-parser.js', () => ({
  parseMovieFolderName: vi.fn(),
  parseFilename: vi.fn(),
  detect3DFormat: vi.fn(),
}))
vi.mock('./ffprobe.js', () => ({ extractTechSpecs: vi.fn() }))
vi.mock('@mediadillo/db', () => ({
  prisma: {
    tvShow: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    season: { findFirst: vi.fn(), create: vi.fn() },
    episode: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    episodeFile: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  MediaType: { movie: 'movie', tv: 'tv' },
  CreditRole: { director: 'director', cast: 'cast' },
}))

import { syncEpisodeFile } from './db-sync.js'
import { detectLocalArtwork } from './artwork-detector.js'
import { parseShowNfo, parseEpisodeNfo } from './nfo-parser.js'
import { detect3DFormat } from './filename-parser.js'
import { prisma } from '@mediadillo/db'

// Typed references to mocked Prisma models
const mockTvShow = prisma.tvShow as unknown as {
  findFirst: ReturnType<typeof vi.fn>
  findUnique: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}
const mockSeason = prisma.season as unknown as {
  findFirst: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}
const mockEpisode = prisma.episode as unknown as {
  findFirst: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  count: ReturnType<typeof vi.fn>
}
const mockEpisodeFile = prisma.episodeFile as unknown as {
  findFirst: ReturnType<typeof vi.fn>
  findUnique: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

const FAKE_SHOW = { id: 'show-1', title: 'Breaking Bad', year: 2008, tmdbId: null, tvdbId: null, overview: null, rating: null, genres: [], posterDownloaded: false, backdropDownloaded: false, ownedEpisodes: 0 }
const FAKE_SEASON = { id: 'season-1', showId: 'show-1', seasonNumber: 1 }
const FAKE_EPISODE = { id: 'episode-1', seasonId: 'season-1', episodeNumber: 1, title: null, airDate: null, status: 'owned' }
const FAKE_EPISODE_FILE = { id: 'ef-1', episodeId: 'episode-1', path: '/tv/Breaking Bad/Season 1/S01E01.mkv', scannedAt: new Date(0), sizeBytes: BigInt(1000) }

const FAKE_TECH_SPECS = {
  videoCodec: 'H.264',
  videoResolution: '1080p',
  videoQualityTier: '1080p',
  hdr: false,
  audioCodec: 'AAC',
  audioChannels: '2.0',
  audioQualityTier: 'stereo',
}

function makeScannedFile(filePath: string, overrides: Partial<{ show: string; year: number | null; season: number; episodes: number[]; episodeTitle: string | null }> = {}) {
  return {
    path: filePath,
    sizeBytes: BigInt(1_000_000_000),
    mtimeMs: Date.now(),
    parsed: {
      type: 'tv' as const,
      show: overrides.show ?? 'Breaking Bad',
      year: overrides.year ?? null,
      season: overrides.season ?? 1,
      episodes: overrides.episodes ?? [1],
      episodeTitle: overrides.episodeTitle ?? null,
    },
    techSpecs: FAKE_TECH_SPECS,
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  // Default artwork: nothing found
  vi.mocked(detectLocalArtwork).mockResolvedValue({ hasPoster: false, hasBackdrop: false })
  // Default NFO: nothing found
  vi.mocked(parseShowNfo).mockResolvedValue(null)
  vi.mocked(parseEpisodeNfo).mockResolvedValue(null)
  vi.mocked(detect3DFormat).mockReturnValue(null)

  // Default DB state: nothing exists yet
  mockTvShow.findFirst.mockResolvedValue(null)
  mockTvShow.findUnique.mockResolvedValue(null)
  mockTvShow.create.mockResolvedValue(FAKE_SHOW)
  mockTvShow.update.mockResolvedValue(FAKE_SHOW)

  mockSeason.findFirst.mockResolvedValue(null)
  mockSeason.create.mockResolvedValue(FAKE_SEASON)

  mockEpisode.findFirst.mockResolvedValue(null)
  mockEpisode.create.mockResolvedValue(FAKE_EPISODE)
  mockEpisode.update.mockResolvedValue(FAKE_EPISODE)
  mockEpisode.count.mockResolvedValue(0)

  mockEpisodeFile.findFirst.mockResolvedValue(null)
  mockEpisodeFile.findUnique.mockResolvedValue(null)
  mockEpisodeFile.create.mockResolvedValue(FAKE_EPISODE_FILE)
  mockEpisodeFile.update.mockResolvedValue(FAKE_EPISODE_FILE)
})

// ---------------------------------------------------------------------------
// Bug 1: showFolder derivation — episode directly in show folder (no Season/)
// ---------------------------------------------------------------------------
describe('syncEpisodeFile — showFolder derivation', () => {
  it('uses fileDir (1 level up) as showFolder when episode is directly in the show folder', async () => {
    // Structure: /tv/Breaking Bad/S01E01.mkv — no Season subfolder
    const filePath = '/tv/Breaking Bad/Breaking Bad S01E01.mkv'
    const file = makeScannedFile(filePath)

    await syncEpisodeFile(file, '/tv')

    // detectLocalArtwork should be called with /tv/Breaking Bad, NOT /tv
    const artworkCall = vi.mocked(detectLocalArtwork).mock.calls[0]
    expect(artworkCall?.[0]).toBe('/tv/Breaking Bad')

    // parseShowNfo should also look in /tv/Breaking Bad
    const nfoCall = vi.mocked(parseShowNfo).mock.calls[0]
    expect(nfoCall?.[0]).toBe('/tv/Breaking Bad')
  })

  it('uses twoUp (2 levels up) as showFolder for the standard Season subfolder structure', async () => {
    // Structure: /tv/Breaking Bad/Season 1/S01E01.mkv — standard layout
    const filePath = '/tv/Breaking Bad/Season 1/Breaking Bad S01E01.mkv'
    const file = makeScannedFile(filePath)

    await syncEpisodeFile(file, '/tv')

    // detectLocalArtwork should be called with /tv/Breaking Bad (2 levels up)
    const artworkCall = vi.mocked(detectLocalArtwork).mock.calls[0]
    expect(artworkCall?.[0]).toBe('/tv/Breaking Bad')

    const nfoCall = vi.mocked(parseShowNfo).mock.calls[0]
    expect(nfoCall?.[0]).toBe('/tv/Breaking Bad')
  })

  it('falls back to twoUp when no scanRootPath is provided (backward compat)', async () => {
    const filePath = '/tv/Breaking Bad/Season 1/Breaking Bad S01E01.mkv'
    const file = makeScannedFile(filePath)

    await syncEpisodeFile(file) // no scanRootPath

    const artworkCall = vi.mocked(detectLocalArtwork).mock.calls[0]
    // Without scanRootPath: twoUp = /tv/Breaking Bad — correct for standard layout
    expect(artworkCall?.[0]).toBe('/tv/Breaking Bad')
  })
})

// ---------------------------------------------------------------------------
// Bug 2: folder-anchored TvShow lookup prevents duplicate creation
// ---------------------------------------------------------------------------
describe('syncEpisodeFile — TvShow deduplication via folder anchor', () => {
  it('reuses an existing TvShow found via showFolder anchor, even if title would not match', async () => {
    // Scenario: first episode was synced with title "Breaking Bad" (no year),
    // second episode filename yields "Breaking Bad 2008" — but the folder anchor
    // should find the existing show and skip title-based lookup entirely.
    const showId = 'show-existing'
    const existingShow = { ...FAKE_SHOW, id: showId, title: 'Breaking Bad' }

    // Simulate an existing EpisodeFile under the show folder
    mockEpisodeFile.findFirst.mockResolvedValue({
      episode: { season: { showId } },
    })
    mockTvShow.findUnique.mockResolvedValue(existingShow)

    const filePath = '/tv/Breaking Bad/Season 1/Breaking Bad 2008 S01E02.mkv'
    const file = makeScannedFile(filePath, { show: 'Breaking Bad 2008', year: 2008 })

    await syncEpisodeFile(file, '/tv')

    // The folder anchor findFirst call must include the show folder path prefix
    expect(mockEpisodeFile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          path: expect.objectContaining({ startsWith: '/tv/Breaking Bad' + path.sep }),
        }),
      }),
    )

    // TvShow.create must NOT be called — we reused the existing show
    expect(mockTvShow.create).not.toHaveBeenCalled()

    // TvShow was loaded via findUnique (the anchor path), not created
    expect(mockTvShow.findUnique).toHaveBeenCalledWith({ where: { id: showId } })
  })

  it('falls back to title-based lookup when no EpisodeFile exists under the show folder yet', async () => {
    // First file for this show: folder anchor finds nothing, title lookup also finds nothing → create
    mockEpisodeFile.findFirst.mockResolvedValue(null)
    mockTvShow.findFirst.mockResolvedValue(null)
    mockTvShow.create.mockResolvedValue(FAKE_SHOW)

    const filePath = '/tv/Breaking Bad/Season 1/Breaking Bad S01E01.mkv'
    const file = makeScannedFile(filePath)

    const result = await syncEpisodeFile(file, '/tv')

    expect(mockTvShow.create).toHaveBeenCalledOnce()
    expect(result).toBe('added')
  })

  it('uses title-based lookup when folder anchor returns nothing and title matches an existing show', async () => {
    // Folder anchor misses (no prior files), but title lookup finds the show.
    // This handles the case where shows are enriched/renamed after first scan.
    const existingShow = { ...FAKE_SHOW, title: 'Breaking Bad' }
    mockEpisodeFile.findFirst.mockResolvedValue(null)
    mockTvShow.findFirst.mockResolvedValue(existingShow)

    const filePath = '/tv/Breaking Bad/Season 1/Breaking Bad S01E01.mkv'
    const file = makeScannedFile(filePath)

    await syncEpisodeFile(file, '/tv')

    expect(mockTvShow.create).not.toHaveBeenCalled()
    expect(mockTvShow.findFirst).toHaveBeenCalled()
  })

  it('returns added for a brand-new episode file', async () => {
    mockEpisodeFile.findFirst.mockResolvedValue(null)
    mockEpisodeFile.findUnique.mockResolvedValue(null)

    const filePath = '/tv/Breaking Bad/Season 1/Breaking Bad S01E01.mkv'
    const file = makeScannedFile(filePath)

    const result = await syncEpisodeFile(file, '/tv')
    expect(result).toBe('added')
    expect(mockEpisodeFile.create).toHaveBeenCalledOnce()
  })

  it('returns unchanged for an existing file with no mtime change', async () => {
    const oldScannedAt = new Date(Date.now() - 10_000)
    mockEpisodeFile.findFirst.mockResolvedValue(null)
    mockTvShow.findFirst.mockResolvedValue(FAKE_SHOW)
    mockEpisodeFile.findUnique.mockResolvedValue({
      ...FAKE_EPISODE_FILE,
      scannedAt: new Date(Date.now() + 99_999), // future → mtime appears unchanged
    })

    const file = makeScannedFile('/tv/Breaking Bad/Season 1/Breaking Bad S01E01.mkv')
    // mtimeMs older than scannedAt
    file.mtimeMs = oldScannedAt.getTime()

    const result = await syncEpisodeFile(file, '/tv')
    expect(result).toBe('unchanged')
    expect(mockEpisodeFile.update).not.toHaveBeenCalled()
  })
})

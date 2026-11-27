import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Issues #105 and #106.
 *
 * Enrichment used to abort on two conditions that are both recoverable, and in
 * both cases the show was left worse off than if nothing had run:
 *
 *  - #105: a stale TMDB id threw before any TVDB work, so a show with perfectly
 *    good TVDB data kept its scanner-derived filename titles forever.
 *  - #106: `findFirst` + `create` races with a concurrent enrich on the unique
 *    (seasonId, episodeNumber) key, and the thrown P2002 abandoned the rest of
 *    the sync — a half-updated library.
 */
vi.mock('@mediadillo/db', () => ({
  TitleSource: { provider: 'provider', manual: 'manual' },
  prisma: {
    episode: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn(async () => 0) },
    season: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    tvShow: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

const { prisma } = await import('@mediadillo/db')
const { createOrSyncEpisode, isUniqueViolation, enrichTvShow } = await import('./enricher.js')

const AIRED = new Date('1976-09-11')
const P2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isUniqueViolation (issue #106)', () => {
  it('recognises Prisma P2002', () => {
    expect(isUniqueViolation(P2002)).toBe(true)
  })

  it('does not swallow other errors', () => {
    expect(isUniqueViolation(new Error('connection reset'))).toBe(false)
    expect(isUniqueViolation(Object.assign(new Error('x'), { code: 'P1001' }))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation('P2002')).toBe(false)
  })
})

describe('createOrSyncEpisode (issue #106)', () => {
  it('creates the row when there is no conflict', async () => {
    vi.mocked(prisma.episode.create).mockResolvedValueOnce({} as never)
    await createOrSyncEpisode('season1', 7, 'I fantasmi di lusso', AIRED, 'missing')
    expect(prisma.episode.create).toHaveBeenCalledOnce()
    expect(prisma.episode.update).not.toHaveBeenCalled()
  })

  it('falls back to an update when a concurrent enrich won the race', async () => {
    vi.mocked(prisma.episode.create).mockRejectedValueOnce(P2002)
    vi.mocked(prisma.episode.findFirst).mockResolvedValueOnce({
      id: 'ep1',
      titleSource: 'provider',
    } as never)
    await createOrSyncEpisode('season1', 7, 'I fantasmi di lusso', AIRED, 'missing')
    expect(prisma.episode.update).toHaveBeenCalledWith({
      where: { id: 'ep1' },
      data: { title: 'I fantasmi di lusso', airDate: AIRED, status: 'missing' },
    })
  })

  it('leaves a locked title alone when resolving the race', async () => {
    vi.mocked(prisma.episode.create).mockRejectedValueOnce(P2002)
    vi.mocked(prisma.episode.findFirst).mockResolvedValueOnce({
      id: 'ep1',
      titleSource: 'manual',
    } as never)
    await createOrSyncEpisode('season1', 7, 'Deluxe Ghosts', AIRED, 'owned')
    const call = vi.mocked(prisma.episode.update).mock.calls[0]
    expect(call).toBeDefined()
    const data = call![0].data as Record<string, unknown>
    expect('title' in data).toBe(false)
  })

  it('rethrows an error that is not a unique violation', async () => {
    vi.mocked(prisma.episode.create).mockRejectedValueOnce(new Error('connection reset'))
    await expect(createOrSyncEpisode('season1', 7, 'x', AIRED, 'missing')).rejects.toThrow(
      'connection reset',
    )
  })

  it('rethrows the conflict when the conflicting row cannot be found', async () => {
    vi.mocked(prisma.episode.create).mockRejectedValueOnce(P2002)
    vi.mocked(prisma.episode.findFirst).mockResolvedValueOnce(null as never)
    await expect(createOrSyncEpisode('season1', 7, 'x', AIRED, 'missing')).rejects.toThrow(
      'Unique constraint failed',
    )
  })
})

describe('enrichTvShow with a dead TMDB id (issue #105)', () => {
  const tmdbClient = {
    getTv: vi.fn(async () => {
      throw new Error('TMDB /tv/6172 → HTTP 404')
    }),
    getExternalIds: vi.fn(),
  }
  const tvdbClient = { getEpisodes: vi.fn(async () => []) }

  it('carries on with TVDB when the show has a tvdbId', async () => {
    vi.mocked(prisma.tvShow.findUnique).mockResolvedValue({
      tvdbId: 73817,
      tvdbOrder: 'official',
    } as never)
    vi.mocked(prisma.season.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.season.aggregate).mockResolvedValue({ _sum: { episodeCount: 0 } } as never)

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enrichTvShow(tmdbClient as any, 'show1', 6172, tvdbClient as any),
    ).resolves.toBeUndefined()

    expect(tvdbClient.getEpisodes).toHaveBeenCalled()
    // No TMDB-sourced show fields were written, because there were none to write.
    expect(prisma.tvShow.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: expect.anything() }) }),
    )
  })

  it('still throws when there is no TVDB fallback', async () => {
    vi.mocked(prisma.tvShow.findUnique).mockResolvedValue({ tvdbId: null } as never)
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enrichTvShow(tmdbClient as any, 'show1', 6172, null),
    ).rejects.toThrow('HTTP 404')
  })
})

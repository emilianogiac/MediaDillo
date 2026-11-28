import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Issue #120 — 12 shows reported `ownedEpisodes > totalEpisodes` because the two
 * fields described different universes: owned counted Season 0 specials, total
 * (the provider's `SUM(Season.episodeCount)`) did not.
 */
vi.mock('@mediadillo/db', () => ({
  prisma: {
    episode: { count: vi.fn() },
    season: { aggregate: vi.fn() },
    tvShow: { update: vi.fn() },
  },
}))

const { prisma } = await import('@mediadillo/db')
const { recalculateShowCounts, recalculateManyShowCounts } = await import('./counts.js')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.episode.count).mockResolvedValue(0)
  vi.mocked(prisma.season.aggregate).mockResolvedValue({ _sum: { episodeCount: 0 } } as never)
})

describe('recalculateShowCounts', () => {
  it('excludes Season 0 when counting owned episodes', async () => {
    await recalculateShowCounts('show-1')
    expect(prisma.episode.count).toHaveBeenCalledWith({
      where: { season: { showId: 'show-1', seasonNumber: { gt: 0 } }, status: 'owned' },
    })
  })

  it('excludes Season 0 when summing the provider total', async () => {
    await recalculateShowCounts('show-1')
    expect(prisma.season.aggregate).toHaveBeenCalledWith({
      where: { showId: 'show-1', seasonNumber: { gt: 0 } },
      _sum: { episodeCount: true },
    })
  })

  it('writes both counters, never just one', async () => {
    vi.mocked(prisma.episode.count).mockResolvedValue(109)
    vi.mocked(prisma.season.aggregate).mockResolvedValue({ _sum: { episodeCount: 109 } } as never)
    await recalculateShowCounts('sampei')
    expect(prisma.tvShow.update).toHaveBeenCalledWith({
      where: { id: 'sampei' },
      data: { ownedEpisodes: 109, totalEpisodes: 109 },
    })
  })

  it('reproduces the Sampei fix: 21 specials no longer inflate owned past total', async () => {
    // Real seasons hold 109 of 109; the 21 owned specials are excluded from both sides.
    vi.mocked(prisma.episode.count).mockResolvedValue(109)
    vi.mocked(prisma.season.aggregate).mockResolvedValue({ _sum: { episodeCount: 109 } } as never)
    const counts = await recalculateShowCounts('sampei')
    expect(counts).toEqual({ owned: 109, total: 109 })
    expect(counts.owned).toBeLessThanOrEqual(counts.total)
  })

  it('treats a null episodeCount sum as zero rather than NaN', async () => {
    vi.mocked(prisma.season.aggregate).mockResolvedValue({ _sum: { episodeCount: null } } as never)
    const counts = await recalculateShowCounts('empty-show')
    expect(counts.total).toBe(0)
    expect(prisma.tvShow.update).toHaveBeenCalledWith({
      where: { id: 'empty-show' },
      data: { ownedEpisodes: 0, totalEpisodes: 0 },
    })
  })

  it('returns the counts it persisted', async () => {
    vi.mocked(prisma.episode.count).mockResolvedValue(78)
    vi.mocked(prisma.season.aggregate).mockResolvedValue({ _sum: { episodeCount: 107 } } as never)
    expect(await recalculateShowCounts('benny-hill')).toEqual({ owned: 78, total: 107 })
  })

  it('uses a supplied transaction client instead of the shared one', async () => {
    const tx = {
      episode: { count: vi.fn().mockResolvedValue(5) },
      season: { aggregate: vi.fn().mockResolvedValue({ _sum: { episodeCount: 5 } }) },
      tvShow: { update: vi.fn() },
    }
    await recalculateShowCounts('show-1', tx as never)
    expect(tx.tvShow.update).toHaveBeenCalledOnce()
    expect(prisma.tvShow.update).not.toHaveBeenCalled()
  })
})

describe('recalculateManyShowCounts', () => {
  it('recomputes each show once, collapsing duplicates', async () => {
    const n = await recalculateManyShowCounts(['a', 'b', 'a', 'b', 'c'])
    expect(n).toBe(3)
    expect(prisma.tvShow.update).toHaveBeenCalledTimes(3)
  })

  it('does nothing when given no shows', async () => {
    expect(await recalculateManyShowCounts([])).toBe(0)
    expect(prisma.tvShow.update).not.toHaveBeenCalled()
  })
})

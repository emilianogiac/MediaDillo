import { prisma } from '@mediadillo/db'
import type { Prisma } from '@mediadillo/db'

/** Either the shared client or an interactive-transaction client. */
export type PrismaLike = typeof prisma | Prisma.TransactionClient

export interface ShowCounts {
  owned: number
  total: number
}

/**
 * Recompute and persist a show's episode counters (issue #120).
 *
 * Both sides must describe the same universe, or the comparison is meaningless.
 * `totalEpisodes` is the provider's declared count — `SUM(Season.episodeCount)`,
 * which excludes specials because a locally-scanned Specials season inflates a
 * total the provider never published. `ownedEpisodes` therefore has to exclude
 * Season 0 as well; counting specials on one side only is what made 12 shows
 * report `owned > total` (Sampei read 130/109, its excess being exactly its 21
 * owned specials).
 *
 * Specials are deliberately out of the completeness contract: they remain
 * visible as their own season, but a show is complete when its real seasons are.
 *
 * Previously fourteen call sites each reimplemented this, and the ones that
 * updated only `ownedEpisodes` let it drift (Snorky stored 110 against 109).
 * Everything now goes through here.
 */
export async function recalculateShowCounts(
  showId: string,
  client: PrismaLike = prisma,
): Promise<ShowCounts> {
  const owned = await client.episode.count({
    where: { season: { showId, seasonNumber: { gt: 0 } }, status: 'owned' },
  })
  const aggregate = await client.season.aggregate({
    where: { showId, seasonNumber: { gt: 0 } },
    _sum: { episodeCount: true },
  })
  const total = aggregate._sum.episodeCount ?? 0

  await client.tvShow.update({
    where: { id: showId },
    data: { ownedEpisodes: owned, totalEpisodes: total },
  })
  return { owned, total }
}

/** Recompute several shows, skipping duplicates. */
export async function recalculateManyShowCounts(
  showIds: Iterable<string>,
  client: PrismaLike = prisma,
): Promise<number> {
  const unique = [...new Set(showIds)]
  for (const showId of unique) {
    await recalculateShowCounts(showId, client)
  }
  return unique.length
}

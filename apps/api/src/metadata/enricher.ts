import { prisma } from '@mediadillo/db'
import type { TmdbClient } from './tmdb-client.js'
import { tmdbImageUrl } from './tmdb-client.js'
import type { TvdbClient, TvdbEpisode } from './tvdb-client.js'

const RATE_LIMIT_MS = 150 // ~6 req/s — well within TMDB's 40/s limit

// ---------------------------------------------------------------------------
// Movies
// ---------------------------------------------------------------------------

export async function enrichMovie(tmdbClient: TmdbClient, movieId: string, tmdbId: number): Promise<void> {
  const details = await tmdbClient.getMovie(tmdbId)

  await prisma.movie.update({
    where: { id: movieId },
    data: {
      tmdbId: details.id,
      imdbId: details.imdb_id,
      title: details.title,
      year: details.release_date ? parseInt(details.release_date.slice(0, 4), 10) : null,
      overview: details.overview,
      tagline: details.tagline,
      runtime: details.runtime,
      rating: details.vote_average,
      genres: details.genres.map((g) => g.name),
      posterUrl: tmdbImageUrl(details.poster_path, 'w500'),
      backdropUrl: tmdbImageUrl(details.backdrop_path, 'w1280'),
    },
  })

  await syncCredits('movie', movieId, details.credits?.cast ?? [], details.credits?.crew ?? [])
}

// ---------------------------------------------------------------------------
// TV Shows
// ---------------------------------------------------------------------------

export async function enrichTvShow(
  tmdbClient: TmdbClient,
  showId: string,
  tmdbId: number,
  tvdbClient: TvdbClient | null = null,
): Promise<void> {
  const details = await tmdbClient.getTv(tmdbId)

  const tvShowStatus = details.status === 'Ended' || details.status === 'Canceled' ? 'ended' : 'continuing'

  await prisma.tvShow.update({
    where: { id: showId },
    data: {
      tmdbId: details.id,
      title: details.name,
      year: details.first_air_date ? parseInt(details.first_air_date.slice(0, 4), 10) : null,
      overview: details.overview,
      genres: details.genres.map((g) => g.name),
      rating: details.vote_average,
      status: tvShowStatus,
      totalEpisodes: details.number_of_episodes,
      posterUrl: tmdbImageUrl(details.poster_path, 'w500'),
      backdropUrl: tmdbImageUrl(details.backdrop_path, 'w1280'),
    },
  })

  await syncCredits('tv', showId, details.credits?.cast ?? [], details.credits?.crew ?? [])

  // Resolve TVDB ID: prefer stored value, fall back to TMDB external_ids
  let resolvedTvdbId: number | null = null
  if (tvdbClient) {
    const dbShow = await prisma.tvShow.findUnique({ where: { id: showId }, select: { tvdbId: true, tvdbOrder: true } })
    resolvedTvdbId = dbShow?.tvdbId ?? null

    if (!resolvedTvdbId) {
      try {
        const ext = await tmdbClient.getExternalIds(tmdbId)
        resolvedTvdbId = ext.tvdb_id
        if (resolvedTvdbId) {
          await prisma.tvShow.update({ where: { id: showId }, data: { tvdbId: resolvedTvdbId } })
        }
      } catch {
        // non-fatal — fall through to TMDB episode data
      }
    }

    const orderType = dbShow?.tvdbOrder ?? 'official'

    if (resolvedTvdbId) {
      // TVDB is the authoritative episode source for TV shows.
      // Use a single bulk fetch so TVDB's own season structure is respected,
      // not TMDB's potentially divergent season/episode numbering.
      await syncAllSeasonsFromTvdb(tvdbClient, showId, resolvedTvdbId, orderType)

      // Specials (S00): only hydrate if we already own some — never create missing rows
      const hasSpecials = await prisma.season.findFirst({ where: { showId, seasonNumber: 0 } })
      if (hasSpecials) {
        await syncSeasonFromTvdb(tvdbClient, showId, resolvedTvdbId, 0, { ownedOnly: true, orderType })
      }
      return
    }
  }

  // No TVDB available — fall back to TMDB for episode data
  for (let s = 1; s <= details.number_of_seasons; s++) {
    await delay(RATE_LIMIT_MS)
    await syncSeasonData(tmdbClient, null, null, showId, tmdbId, s)
  }

  const hasSpecials = await prisma.season.findFirst({ where: { showId, seasonNumber: 0 } })
  if (hasSpecials) {
    await delay(RATE_LIMIT_MS)
    await syncSeasonData(tmdbClient, null, null, showId, tmdbId, 0, { ownedOnly: true })
  }
}

export async function syncSeasonTitles(
  tmdbClient: TmdbClient,
  showId: string,
  tmdbId: number,
  seasonNumber: number,
  tvdbClient: TvdbClient | null = null,
): Promise<void> {
  const dbShow = tvdbClient
    ? (await prisma.tvShow.findUnique({ where: { id: showId }, select: { tvdbId: true, tvdbOrder: true } }))
    : null
  const tvdbId = dbShow?.tvdbId ?? null
  const orderType = dbShow?.tvdbOrder ?? 'official'
  // Season 0 (Specials): never create missing rows, only hydrate what we own
  return syncSeasonData(tmdbClient, tvdbClient, tvdbId, showId, tmdbId, seasonNumber, {
    ownedOnly: seasonNumber === 0,
    orderType,
  })
}

// ---------------------------------------------------------------------------
// Season dispatch — use TVDB when available, fall back to TMDB per season
// ---------------------------------------------------------------------------

async function syncSeasonData(
  tmdbClient: TmdbClient,
  tvdbClient: TvdbClient | null,
  tvdbId: number | null,
  showId: string,
  tmdbId: number,
  seasonNumber: number,
  options: { ownedOnly?: boolean; orderType?: string } = {},
): Promise<void> {
  if (tvdbClient && tvdbId) {
    try {
      await syncSeasonFromTvdb(tvdbClient, showId, tvdbId, seasonNumber, options)
      return
    } catch {
      // fall through to TMDB for this season
    }
  }
  await syncSeason(tmdbClient, showId, tmdbId, seasonNumber, options)
}

// ---------------------------------------------------------------------------
// TVDB season sync
// ---------------------------------------------------------------------------

async function syncSeasonFromTvdb(
  tvdbClient: TvdbClient,
  showId: string,
  tvdbId: number,
  seasonNumber: number,
  options: { ownedOnly?: boolean; orderType?: string } = {},
): Promise<void> {
  const { ownedOnly = false, orderType = 'official' } = options
  const allEpisodes = await tvdbClient.getEpisodes(tvdbId, orderType, seasonNumber)
  // Filter out TVDB placeholder entries with no episode number assigned yet
  const episodes = allEpisodes.filter((ep): ep is TvdbEpisode & { number: number } => ep.number != null)

  // Upsert season
  let dbSeason = await prisma.season.findFirst({ where: { showId, seasonNumber } })
  if (!dbSeason) {
    if (ownedOnly) return
    if (episodes.length === 0) return  // don't create phantom empty-season records
    dbSeason = await prisma.season.create({
      data: { showId, seasonNumber, episodeCount: episodes.length },
    })
  } else if (!ownedOnly) {
    // Only update episodeCount when syncing the full season structure.
    // In ownedOnly mode (Season 0 title hydration), we must not overwrite episodeCount
    // because the TVDB per-season API may return incorrect results for shows with no
    // specials (e.g. returning all Season 1 episodes when queried with ?season=0).
    await prisma.season.update({
      where: { id: dbSeason.id },
      data: { episodeCount: episodes.length },
    })
  }

  const today = new Date()

  for (const ep of episodes) {
    const airDate = ep.aired ? new Date(ep.aired) : null
    const existing = await prisma.episode.findFirst({
      where: { seasonId: dbSeason.id, episodeNumber: ep.number },
    })

    if (!existing) {
      if (ownedOnly) continue
      const status = airDate && airDate > today ? 'not_yet_aired' : 'missing'
      await prisma.episode.create({
        data: {
          seasonId: dbSeason.id,
          episodeNumber: ep.number,
          title: ep.name,
          airDate,
          status,
        },
      })
    } else {
      const newStatus =
        existing.status === 'owned' || existing.status === 'ignored'
          ? existing.status
          : airDate && airDate > today
            ? 'not_yet_aired'
            : 'missing'

      await prisma.episode.update({
        where: { id: existing.id },
        data: { title: ep.name, airDate, status: newStatus },
      })
    }
  }

  // Update show totals
  const ownedCount = await prisma.episode.count({
    where: { season: { showId }, status: 'owned' },
  })
  // totalEpisodes = sum of episodeCount across all seasons that TVDB has metadata for.
  // Counting Episode rows directly inflates the total with locally-scanned files
  // in e.g. a Specials season that TVDB doesn't know about.
  const seasonCounts = await prisma.season.aggregate({
    where: { showId },
    _sum: { episodeCount: true },
  })
  const totalCount = seasonCounts._sum.episodeCount ?? 0
  await prisma.tvShow.update({
    where: { id: showId },
    data: { ownedEpisodes: ownedCount, totalEpisodes: totalCount },
  })
}

// ---------------------------------------------------------------------------
// TVDB episode sync — all episodes flat, grouped by seasonNumber
// ---------------------------------------------------------------------------

async function syncAllSeasonsFromTvdb(
  tvdbClient: TvdbClient,
  showId: string,
  tvdbId: number,
  orderType: string,
): Promise<void> {
  const episodes = await tvdbClient.getEpisodes(tvdbId, orderType)

  // Skip episodes TVDB hasn't assigned a number to yet (null number would violate
  // the non-nullable episodeNumber Int column and the unique [seasonId, episodeNumber] constraint).
  // Also deduplicate within each season by episode number — TVDB occasionally returns
  // duplicate entries in absolute ordering for specials/OVAs.
  const validEpisodes = episodes.filter((ep): ep is TvdbEpisode & { number: number } => ep.number != null)

  // Group by seasonNumber as reported by TVDB (null seasonNumber → treat as season 1)
  const bySeasonNumber = new Map<number, Array<TvdbEpisode & { number: number }>>()
  for (const ep of validEpisodes) {
    const sn = ep.seasonNumber ?? 1
    const arr = bySeasonNumber.get(sn) ?? []
    arr.push(ep)
    bySeasonNumber.set(sn, arr)
  }

  const today = new Date()

  for (const [seasonNumber, eps] of bySeasonNumber) {
    // Deduplicate by episode number within the season — keep the first occurrence
    const seen = new Set<number>()
    const uniqueEps = eps.filter((ep) => {
      if (seen.has(ep.number)) return false
      seen.add(ep.number)
      return true
    })

    let dbSeason = await prisma.season.findFirst({ where: { showId, seasonNumber } })
    if (!dbSeason) {
      // Never auto-create a specials season — it must be discovered by the scanner first
      if (seasonNumber === 0) continue
      dbSeason = await prisma.season.create({
        data: { showId, seasonNumber, episodeCount: uniqueEps.length },
      })
    } else if (seasonNumber !== 0) {
      // Never update episodeCount on an existing Season 0 — it is scanner-created only and
      // TVDB may return Season 1 episodes under ?season=0 for shows with no actual specials,
      // which would corrupt the count. Season 0 episodeCount stays at 0 (scanner default).
      await prisma.season.update({
        where: { id: dbSeason.id },
        data: { episodeCount: uniqueEps.length },
      })
    }

    for (const ep of uniqueEps) {
      const airDate = ep.aired ? new Date(ep.aired) : null
      const existing = await prisma.episode.findFirst({
        where: { seasonId: dbSeason.id, episodeNumber: ep.number },
      })

      if (!existing) {
        const status = airDate && airDate > today ? 'not_yet_aired' : 'missing'
        await prisma.episode.create({
          data: {
            seasonId: dbSeason.id,
            episodeNumber: ep.number,
            title: ep.name,
            airDate,
            status,
          },
        })
      } else {
        const newStatus =
          existing.status === 'owned' || existing.status === 'ignored'
            ? existing.status
            : airDate && airDate > today
              ? 'not_yet_aired'
              : 'missing'
        await prisma.episode.update({
          where: { id: existing.id },
          data: { title: ep.name, airDate, status: newStatus },
        })
      }
    }
  }

  const ownedCount = await prisma.episode.count({ where: { season: { showId }, status: 'owned' } })
  // totalEpisodes = sum of episodeCount across seasons (TVDB-reported targets only).
  // Counting Episode rows inflates the total with locally-scanned unmatched files.
  const seasonCounts2 = await prisma.season.aggregate({
    where: { showId },
    _sum: { episodeCount: true },
  })
  const totalCount = seasonCounts2._sum.episodeCount ?? 0
  await prisma.tvShow.update({
    where: { id: showId },
    data: { ownedEpisodes: ownedCount, totalEpisodes: totalCount },
  })
}

async function syncAllSeasonsAbsolute(tvdbClient: TvdbClient, showId: string, tvdbId: number): Promise<void> {
  return syncAllSeasonsFromTvdb(tvdbClient, showId, tvdbId, 'absolute')
}

// ---------------------------------------------------------------------------
// TVDB-only show enrichment (no TMDB)
// ---------------------------------------------------------------------------

export async function enrichShowFromTvdb(
  tvdbClient: TvdbClient,
  showId: string,
  tvdbId: number,
): Promise<void> {
  const series = await tvdbClient.getSeries(tvdbId)
  const statusName = series.status?.toLowerCase() ?? ''
  const status = statusName.includes('end') || statusName.includes('cancel') ? 'ended' : 'continuing'

  await prisma.tvShow.update({
    where: { id: showId },
    data: {
      tvdbId,
      tmdbId: null,
      title: series.name,
      year: series.firstAired ? parseInt(series.firstAired.slice(0, 4), 10) : null,
      overview: series.overview,
      status,
      posterUrl: series.image,
      genres: [],
      rating: null,
      backdropUrl: null,
    },
  })

  const dbShow = await prisma.tvShow.findUnique({ where: { id: showId }, select: { tvdbOrder: true } })
  let orderType = dbShow?.tvdbOrder ?? 'official'

  // Some shows (older anime, international) only have episodes under 'absolute' ordering.
  // If the preferred order returns nothing, fall back to 'absolute' and persist it so future
  // enrichments use the right ordering automatically.
  if (orderType === 'official') {
    const probe = await tvdbClient.getEpisodes(tvdbId, 'official')
    if (probe.length === 0) {
      const fallback = await tvdbClient.getEpisodes(tvdbId, 'absolute')
      if (fallback.length > 0) {
        orderType = 'absolute'
        await prisma.tvShow.update({ where: { id: showId }, data: { tvdbOrder: 'absolute' } })
      }
    }
  }

  await syncAllSeasonsFromTvdb(tvdbClient, showId, tvdbId, orderType)
}

// ---------------------------------------------------------------------------
// TMDB season sync (original)
// ---------------------------------------------------------------------------

async function syncSeason(
  tmdbClient: TmdbClient,
  showId: string,
  tmdbId: number,
  seasonNumber: number,
  options: { ownedOnly?: boolean } = {},
): Promise<void> {
  const { ownedOnly = false } = options
  const season = await tmdbClient.getTvSeason(tmdbId, seasonNumber)

  // Upsert season
  let dbSeason = await prisma.season.findFirst({ where: { showId, seasonNumber } })
  if (!dbSeason) {
    if (ownedOnly) return // Don't create a Season 0 record if we have no owned specials
    if (season.episodes.length === 0) return  // don't create phantom empty-season records
    dbSeason = await prisma.season.create({
      data: { showId, seasonNumber, episodeCount: season.episodes.length },
    })
  } else {
    await prisma.season.update({
      where: { id: dbSeason.id },
      data: { episodeCount: season.episodes.length },
    })
  }

  const today = new Date()

  for (const ep of season.episodes) {
    const airDate = ep.air_date ? new Date(ep.air_date) : null
    const existing = await prisma.episode.findFirst({
      where: { seasonId: dbSeason.id, episodeNumber: ep.episode_number },
    })

    if (!existing) {
      if (ownedOnly) continue // Never create missing/not_yet_aired rows for specials
      const status = airDate && airDate > today ? 'not_yet_aired' : 'missing'
      await prisma.episode.create({
        data: {
          seasonId: dbSeason.id,
          episodeNumber: ep.episode_number,
          title: ep.name,
          airDate,
          status,
        },
      })
    } else {
      // Update title and air date; preserve 'owned' and 'ignored' statuses
      const newStatus =
        existing.status === 'owned' || existing.status === 'ignored'
          ? existing.status
          : airDate && airDate > today
            ? 'not_yet_aired'
            : 'missing'

      await prisma.episode.update({
        where: { id: existing.id },
        data: { title: ep.name, airDate, status: newStatus },
      })
    }
  }

  // Update show totals
  const ownedCount = await prisma.episode.count({
    where: { season: { showId }, status: 'owned' },
  })
  // totalEpisodes = sum of episodeCount across seasons (metadata-source targets only).
  // Counting Episode rows inflates the total with locally-scanned unmatched files.
  const seasonCounts3 = await prisma.season.aggregate({
    where: { showId },
    _sum: { episodeCount: true },
  })
  const totalCount = seasonCounts3._sum.episodeCount ?? 0
  await prisma.tvShow.update({
    where: { id: showId },
    data: { ownedEpisodes: ownedCount, totalEpisodes: totalCount },
  })
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

async function syncCredits(
  mediaType: 'movie' | 'tv',
  mediaId: string,
  cast: Array<{ id: number; name: string; character: string; order: number; profile_path: string | null }>,
  crew: Array<{ id: number; name: string; job: string; profile_path: string | null }>,
): Promise<void> {
  // Delete existing credits for this item before re-adding
  await prisma.credit.deleteMany({
    where: mediaType === 'movie' ? { movieId: mediaId } : { showId: mediaId },
  })

  const topCast = cast.slice(0, 20) // limit cast to top 20 for storage efficiency

  for (const member of topCast) {
    const person = await upsertPerson(member.id, member.name, member.profile_path)
    await prisma.credit.create({
      data: {
        personId: person.id,
        mediaType,
        movieId: mediaType === 'movie' ? mediaId : null,
        showId: mediaType === 'tv' ? mediaId : null,
        role: 'cast',
        character: member.character,
        order: member.order,
      },
    })
  }

  // Directors and writers from crew
  const keyCrewJobs = new Set(['Director', 'Writer', 'Screenplay', 'Story'])
  const keyCrew = crew.filter((c) => keyCrewJobs.has(c.job))
  for (const member of keyCrew) {
    const person = await upsertPerson(member.id, member.name, member.profile_path)
    const role = member.job === 'Director' ? 'director' : 'writer'
    await prisma.credit.create({
      data: {
        personId: person.id,
        mediaType,
        movieId: mediaType === 'movie' ? mediaId : null,
        showId: mediaType === 'tv' ? mediaId : null,
        role,
        character: null,
        order: null,
      },
    })
  }
}

async function upsertPerson(
  tmdbId: number,
  name: string,
  profilePath: string | null,
) {
  const profileUrl = profilePath ? `https://image.tmdb.org/t/p/w185${profilePath}` : null
  const existing = await prisma.person.findFirst({ where: { tmdbId } })
  if (existing) return existing
  return prisma.person.create({ data: { tmdbId, name, profileUrl } })
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

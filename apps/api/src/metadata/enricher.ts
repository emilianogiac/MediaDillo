import { prisma } from '@mediadillo/db'
import type { TmdbClient } from './tmdb-client.js'
import { tmdbImageUrl } from './tmdb-client.js'

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

export async function enrichTvShow(tmdbClient: TmdbClient, showId: string, tmdbId: number): Promise<void> {
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

  // Fetch all seasons and reconcile episodes
  for (let s = 1; s <= details.number_of_seasons; s++) {
    await delay(RATE_LIMIT_MS)
    await syncSeason(tmdbClient, showId, tmdbId, s)
  }
}

async function syncSeason(
  tmdbClient: TmdbClient,
  showId: string,
  tmdbId: number,
  seasonNumber: number,
): Promise<void> {
  const season = await tmdbClient.getTvSeason(tmdbId, seasonNumber)

  // Upsert season
  let dbSeason = await prisma.season.findFirst({ where: { showId, seasonNumber } })
  if (!dbSeason) {
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
      // Episode not in our library — determine status
      const status =
        airDate && airDate > today ? 'not_yet_aired' : 'missing'

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
  const totalCount = await prisma.episode.count({ where: { season: { showId } } })
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

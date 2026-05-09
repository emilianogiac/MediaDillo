import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { TmdbClient } from '../metadata/tmdb-client.js'
import { searchMovieCandidates } from '../metadata/matcher.js'
import { getApiConfig } from '../api-config.js'

export async function missingRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/missing/shows — shows with at least one missing episode, sorted by missing count desc
  app.get('/missing/shows', async (_req, reply) => {
    const shows = await prisma.tvShow.findMany({
      where: {
        seasons: { some: { episodes: { some: { status: 'missing' } } } },
      },
      select: {
        id: true,
        title: true,
        year: true,
        posterUrl: true,
        ownedEpisodes: true,
        totalEpisodes: true,
        status: true,
        seasons: {
          select: {
            seasonNumber: true,
            _count: { select: { episodes: { where: { status: 'missing' } } } },
          },
        },
      },
      orderBy: { title: 'asc' },
    })

    const result = shows
      .map((show) => ({
        id: show.id,
        title: show.title,
        year: show.year,
        posterUrl: show.posterUrl,
        ownedEpisodes: show.ownedEpisodes,
        totalEpisodes: show.totalEpisodes,
        showStatus: show.status,
        missingCount: show.seasons.reduce((acc, s) => acc + s._count.episodes, 0),
      }))
      .sort((a, b) => b.missingCount - a.missingCount)

    return reply.send(result)
  })

  // GET /api/missing/movies — movies with status = 'wanted'
  app.get('/missing/movies', async (_req, reply) => {
    const movies = await prisma.movie.findMany({
      where: { status: 'wanted' },
      select: {
        id: true,
        title: true,
        year: true,
        posterUrl: true,
        overview: true,
        rating: true,
        genres: true,
        tmdbId: true,
        imdbId: true,
      },
      orderBy: { title: 'asc' },
    })
    return reply.send(movies)
  })

  // POST /api/missing/movies — add a movie to the wishlist
  app.post<{
    Body: {
      title: string
      year?: number
      tmdbId?: number
      overview?: string
      posterUrl?: string
      rating?: number
      genres?: string[]
    }
  }>('/missing/movies', async (req, reply) => {
    const { title, year, tmdbId, overview, posterUrl, rating, genres } = req.body
    if (!title) return reply.code(400).send({ error: 'title is required' })

    // If tmdbId supplied, check for duplicate wanted/owned entry
    if (tmdbId) {
      const existing = await prisma.movie.findFirst({ where: { tmdbId } })
      if (existing) {
        return reply.code(409).send({
          error: existing.status === 'owned'
            ? 'You already own this movie'
            : 'Movie is already in your wishlist',
          existingId: existing.id,
        })
      }
    }

    const movie = await prisma.movie.create({
      data: {
        title,
        year: year ?? null,
        tmdbId: tmdbId ?? null,
        overview: overview ?? null,
        posterUrl: posterUrl ?? null,
        rating: rating ?? null,
        genres: genres ?? [],
        status: 'wanted',
      },
    })
    return reply.code(201).send(movie)
  })

  // DELETE /api/missing/movies/:id — remove from wishlist (only wanted movies)
  app.delete<{ Params: { id: string } }>('/missing/movies/:id', async (req, reply) => {
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })
    if (movie.status !== 'wanted') {
      return reply.code(409).send({ error: 'Only wanted movies can be removed from the wishlist' })
    }
    await prisma.movie.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // GET /api/missing/movie-search?q=&year= — search TMDB for movies to add to wishlist
  app.get<{ Querystring: { q?: string; year?: string } }>(
    '/missing/movie-search',
    async (req, reply) => {
      const { q, year } = req.query
      if (!q) return reply.code(400).send({ error: 'q is required' })
      const { tmdbApiKey } = await getApiConfig()
      if (!tmdbApiKey) return reply.code(422).send({ error: 'TMDB API key not configured' })

      const client = new TmdbClient(tmdbApiKey)
      const yearNum = year ? parseInt(year, 10) : null
      const candidates = await searchMovieCandidates(client, q, isNaN(yearNum ?? NaN) ? null : yearNum)
      return reply.send(candidates)
    },
  )

  // PATCH /api/missing/shows/:showId/episodes/:episodeId — toggle episode status
  app.patch<{
    Params: { showId: string; episodeId: string }
    Body: { status: 'owned' | 'missing' | 'ignored' }
  }>('/missing/shows/:showId/episodes/:episodeId', async (req, reply) => {
    const { status } = req.body
    const allowed = ['owned', 'missing', 'ignored'] as const
    if (!allowed.includes(status)) {
      return reply.code(400).send({ error: 'status must be owned, missing, or ignored' })
    }

    const episode = await prisma.episode.findUnique({
      where: { id: req.params.episodeId },
      include: { season: { select: { showId: true } } },
    })
    if (!episode || episode.season.showId !== req.params.showId) {
      return reply.code(404).send({ error: 'Episode not found' })
    }

    const updated = await prisma.episode.update({
      where: { id: req.params.episodeId },
      data: { status },
    })

    // Refresh ownedEpisodes counter on the show
    const ownedCount = await prisma.episode.count({
      where: { season: { showId: req.params.showId }, status: 'owned' },
    })
    await prisma.tvShow.update({
      where: { id: req.params.showId },
      data: { ownedEpisodes: ownedCount },
    })

    return reply.send(updated)
  })
}

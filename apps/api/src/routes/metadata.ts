import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { TmdbClient } from '../metadata/tmdb-client.js'
import { searchMovieCandidates, searchTvCandidates } from '../metadata/matcher.js'
import { enrichMovie, enrichTvShow } from '../metadata/enricher.js'
import { runMetadataScan, isMetadataScanRunning } from '../metadata/index.js'
import { config } from '../config.js'

function getTmdbClient(): TmdbClient {
  if (!config.TMDB_API_KEY) throw new Error('TMDB_API_KEY is not configured')
  return new TmdbClient(config.TMDB_API_KEY)
}

export async function metadataRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/metadata/scan — batch auto-match all unmatched items
  app.post('/metadata/scan', async (_req, reply) => {
    if (!config.TMDB_API_KEY) {
      return reply.code(422).send({ error: 'TMDB_API_KEY is not configured' })
    }
    if (isMetadataScanRunning()) {
      return reply.code(409).send({ error: 'Metadata scan already in progress' })
    }

    const client = getTmdbClient()
    runMetadataScan(client).catch((err: unknown) => {
      app.log.error(err, 'Metadata scan failed')
    })

    return reply.code(202).send({ message: 'Metadata scan started' })
  })

  // GET /api/metadata/status
  app.get('/metadata/status', async (_req, reply) => {
    return reply.send({ scanning: isMetadataScanRunning() })
  })

  // GET /api/metadata/unmatched — items without a TMDB ID
  app.get('/metadata/unmatched', async (_req, reply) => {
    const [movies, shows] = await Promise.all([
      prisma.movie.findMany({
        where: { tmdbId: null },
        select: { id: true, title: true, year: true, scanRootId: true },
        orderBy: { title: 'asc' },
      }),
      prisma.tvShow.findMany({
        where: { tmdbId: null },
        select: { id: true, title: true, year: true },
        orderBy: { title: 'asc' },
      }),
    ])
    return reply.send({ movies, shows, total: movies.length + shows.length })
  })

  // GET /api/metadata/movies/:id/candidates — search TMDB for manual selection
  app.get<{ Params: { id: string } }>('/metadata/movies/:id/candidates', async (req, reply) => {
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })

    const client = getTmdbClient()
    const candidates = await searchMovieCandidates(client, movie.title, movie.year)
    return reply.send({ movie: { id: movie.id, title: movie.title, year: movie.year }, candidates })
  })

  // GET /api/metadata/shows/:id/candidates
  app.get<{ Params: { id: string } }>('/metadata/shows/:id/candidates', async (req, reply) => {
    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    const client = getTmdbClient()
    const candidates = await searchTvCandidates(client, show.title, show.year)
    return reply.send({ show: { id: show.id, title: show.title, year: show.year }, candidates })
  })

  // POST /api/metadata/movies/:id/match — manual or auto-match to a TMDB ID
  app.post<{ Params: { id: string }; Body: { tmdbId: number } }>(
    '/metadata/movies/:id/match',
    async (req, reply) => {
      const movie = await prisma.movie.findUnique({ where: { id: req.params.id } })
      if (!movie) return reply.code(404).send({ error: 'Movie not found' })

      const { tmdbId } = req.body
      if (!tmdbId || typeof tmdbId !== 'number') {
        return reply.code(400).send({ error: 'tmdbId is required' })
      }

      const client = getTmdbClient()
      await enrichMovie(client, movie.id, tmdbId)

      const updated = await prisma.movie.findUnique({ where: { id: movie.id } })
      return reply.send(updated)
    },
  )

  // POST /api/metadata/shows/:id/match
  app.post<{ Params: { id: string }; Body: { tmdbId: number } }>(
    '/metadata/shows/:id/match',
    async (req, reply) => {
      const show = await prisma.tvShow.findUnique({ where: { id: req.params.id } })
      if (!show) return reply.code(404).send({ error: 'Show not found' })

      const { tmdbId } = req.body
      if (!tmdbId || typeof tmdbId !== 'number') {
        return reply.code(400).send({ error: 'tmdbId is required' })
      }

      const client = getTmdbClient()
      await enrichTvShow(client, show.id, tmdbId)

      const updated = await prisma.tvShow.findUnique({ where: { id: show.id } })
      return reply.send(updated)
    },
  )

  // PUT /api/metadata/movies/:id — manual field override
  app.put<{
    Params: { id: string }
    Body: {
      title?: string; year?: number; overview?: string; tagline?: string
      rating?: number; runtime?: number; posterUrl?: string; backdropUrl?: string
    }
  }>('/metadata/movies/:id', async (req, reply) => {
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })

    const updated = await prisma.movie.update({
      where: { id: req.params.id },
      data: req.body,
    })
    return reply.send(updated)
  })

  // PUT /api/metadata/shows/:id — manual field override
  app.put<{
    Params: { id: string }
    Body: { title?: string; year?: number; overview?: string; posterUrl?: string; backdropUrl?: string }
  }>('/metadata/shows/:id', async (req, reply) => {
    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    const updated = await prisma.tvShow.update({
      where: { id: req.params.id },
      data: req.body,
    })
    return reply.send(updated)
  })
}

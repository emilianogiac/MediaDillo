import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'

type QualityTier = 'SD' | '720p' | '1080p' | '4K'

export async function moviesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/movies?scanRootId=&genre=&qualityTier=&missingArtwork=&unmatched=&search=
  app.get<{
    Querystring: {
      scanRootId?: string
      genre?: string
      qualityTier?: QualityTier
      missingArtwork?: string
      unmatched?: string
      search?: string
    }
  }>('/movies', async (req, reply) => {
    const { scanRootId, genre, qualityTier, missingArtwork, unmatched, search } = req.query

    const movies = await prisma.movie.findMany({
      where: {
        ...(scanRootId ? { scanRootId } : {}),
        ...(genre ? { genres: { has: genre } } : {}),
        ...(qualityTier ? { files: { some: { videoQualityTier: qualityTier } } } : {}),
        ...(missingArtwork === 'true'
          ? { OR: [{ posterDownloaded: false }, { backdropDownloaded: false }] }
          : {}),
        ...(unmatched === 'true' ? { tmdbId: null } : {}),
        ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        title: true,
        year: true,
        posterUrl: true,
        genres: true,
        rating: true,
        runtime: true,
        tmdbId: true,
        posterDownloaded: true,
        backdropDownloaded: true,
        status: true,
        scanRoot: { select: { id: true, label: true } },
        files: { select: { videoQualityTier: true }, take: 1 },
      },
      orderBy: { title: 'asc' },
    })

    return reply.send(movies)
  })

  // GET /api/movies/:id — full detail with files + credits
  app.get<{ Params: { id: string } }>('/movies/:id', async (req, reply) => {
    const movie = await prisma.movie.findUnique({
      where: { id: req.params.id },
      include: {
        scanRoot: true,
        files: { orderBy: { path: 'asc' } },
        credits: {
          include: { person: true },
          orderBy: { role: 'asc' },
        },
      },
    })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })
    return reply.send(movie)
  })
}

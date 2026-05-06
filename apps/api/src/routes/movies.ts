import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'

type QualityTier = 'SD' | '720p' | '1080p' | '4K'

export async function moviesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/movies?scanRootId=&genre=&qualityTier=&missingArtwork=&unmatched=&search=&duplicates=only|hide
  app.get<{
    Querystring: {
      scanRootId?: string
      genre?: string
      qualityTier?: QualityTier
      missingArtwork?: string
      unmatched?: string
      search?: string
      duplicates?: string
    }
  }>('/movies', async (req, reply) => {
    const { scanRootId, genre, qualityTier, missingArtwork, unmatched, search, duplicates } = req.query

    // Find tmdbIds that appear more than once (multiple editions/versions)
    const dupGroups = duplicates
      ? await prisma.movie.groupBy({
          by: ['tmdbId'],
          where: { tmdbId: { not: null } },
          having: { tmdbId: { _count: { gt: 1 } } },
        })
      : []
    const dupTmdbIds = dupGroups.map((g) => g.tmdbId as number)

    const movies = await prisma.movie.findMany({
      where: {
        // Only return movies from movies-type scan roots (or no scan root assigned)
        OR: [
          { scanRootId: null },
          { scanRoot: { type: 'movies' } },
        ],
        ...(scanRootId ? { scanRootId } : {}),
        ...(genre ? { genres: { has: genre } } : {}),
        ...(qualityTier ? { files: { some: { videoQualityTier: qualityTier } } } : {}),
        ...(missingArtwork === 'true'
          ? { OR: [{ posterDownloaded: false }, { backdropDownloaded: false }] }
          : {}),
        ...(unmatched === 'true' ? { tmdbId: null } : {}),
        ...(duplicates === 'only' && dupTmdbIds.length > 0 ? { tmdbId: { in: dupTmdbIds } } : {}),
        ...(duplicates === 'hide' && dupTmdbIds.length > 0 ? { NOT: { tmdbId: { in: dupTmdbIds } } } : {}),
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

    // Tag each movie with isDuplicate for the badge
    const dupSet = new Set(dupTmdbIds)
    const tagged = movies.map((m) => ({ ...m, isDuplicate: m.tmdbId != null && dupSet.has(m.tmdbId) }))

    return reply.send(tagged)
  })

  // POST /api/movies/cleanup-tv-contamination — delete Movie records that belong to TV-type scan roots
  // These were created before the scanner was fixed to route files by root type.
  app.post('/movies/cleanup-tv-contamination', async (_req, reply) => {
    const tvRoots = await prisma.scanRoot.findMany({ where: { type: 'tv' } })
    if (tvRoots.length === 0) return reply.send({ deleted: 0 })
    const tvRootIds = tvRoots.map((r) => r.id)

    const contaminated = await prisma.movie.findMany({
      where: { scanRootId: { in: tvRootIds } },
      select: { id: true },
    })
    const ids = contaminated.map((m) => m.id)
    if (ids.length === 0) return reply.send({ deleted: 0 })

    await prisma.movieFile.deleteMany({ where: { movieId: { in: ids } } })
    await prisma.movie.deleteMany({ where: { id: { in: ids } } })

    return reply.send({ deleted: ids.length })
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

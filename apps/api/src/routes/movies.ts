import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { runMovieFolderScan, isScanRunning } from '../scanner/index.js'

type QualityTier = 'SD' | '720p' | '1080p' | '4K'

export async function moviesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/movies?scanRootId=&genre=&qualityTier=&missingArtwork=&unmatched=&search=&duplicates=only|hide&missingFile=true
  app.get<{
    Querystring: {
      scanRootId?: string
      genre?: string
      qualityTier?: QualityTier
      missingArtwork?: string
      unmatched?: string
      search?: string
      duplicates?: string
      missingFile?: string
    }
  }>('/movies', async (req, reply) => {
    const { scanRootId, genre, qualityTier, missingArtwork, unmatched, search, duplicates, missingFile } = req.query

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
        ...(missingFile === 'true' ? { files: { none: {} } } : {}),
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

  // DELETE /api/movies/:id — remove a stale record with no files
  app.delete<{ Params: { id: string } }>('/movies/:id', async (req, reply) => {
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })
    await prisma.movie.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // GET /api/movies/:id — full detail with files + credits
  app.get<{ Params: { id: string } }>('/movies/:id', async (req, reply) => {
    const movie = await prisma.movie.findUnique({
      where: { id: req.params.id },
      include: {
        scanRoot: true,
        files: { orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }] },
        credits: {
          include: { person: true },
          orderBy: { role: 'asc' },
        },
      },
    })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })
    return reply.send(movie)
  })

  // POST /api/movies/:id/rescan — re-scan the movie's folder
  app.post<{ Params: { id: string } }>('/movies/:id/rescan', async (req, reply) => {
    if (isScanRunning()) return reply.code(409).send({ error: 'A full scan is already running' })
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })
    try {
      const counts = await runMovieFolderScan(req.params.id)
      return reply.send(counts)
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Rescan failed' })
    }
  })

  // PATCH /api/movies/:id/files/order — set file sort order
  app.patch<{ Params: { id: string }; Body: { fileIds: string[] } }>(
    '/movies/:id/files/order',
    async (req, reply) => {
      const { fileIds } = req.body
      if (!Array.isArray(fileIds)) return reply.code(400).send({ error: 'fileIds must be an array' })

      await Promise.all(
        fileIds.map((id, idx) =>
          prisma.movieFile.update({ where: { id }, data: { sortOrder: idx } }),
        ),
      )
      return reply.send({ updated: fileIds.length })
    },
  )
}

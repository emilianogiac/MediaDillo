import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { downloadMovieArtwork, downloadShowArtwork } from '../artwork/downloader.js'
import { searchMovieImages, searchTvImages, tmdbImageUrl } from '../artwork/searcher.js'
import { runBulkArtworkDownload, isBulkArtworkRunning } from '../artwork/index.js'
import { saveImage } from '../artwork/downloader.js'
import { config } from '../config.js'
import path from 'node:path'

export async function artworkRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/artwork/bulk — download all missing artwork
  app.post('/artwork/bulk', async (_req, reply) => {
    if (isBulkArtworkRunning()) {
      return reply.code(409).send({ error: 'Bulk download already in progress' })
    }
    runBulkArtworkDownload().catch((err: unknown) => {
      app.log.error(err, 'Bulk artwork download failed')
    })
    return reply.code(202).send({ message: 'Bulk artwork download started' })
  })

  // GET /api/artwork/status
  app.get('/artwork/status', async (_req, reply) => {
    return reply.send({ running: isBulkArtworkRunning() })
  })

  // POST /api/artwork/movies/:id/download?type=poster|backdrop|all
  app.post<{ Params: { id: string }; Querystring: { type?: string } }>(
    '/artwork/movies/:id/download',
    async (req, reply) => {
      const rawType = req.query.type
      const type =
        rawType === 'poster' || rawType === 'backdrop' ? rawType : 'all'

      const result = await downloadMovieArtwork(req.params.id, type)
      return reply.send(result)
    },
  )

  // POST /api/artwork/shows/:id/download?type=poster|backdrop|all
  app.post<{ Params: { id: string }; Querystring: { type?: string } }>(
    '/artwork/shows/:id/download',
    async (req, reply) => {
      const rawType = req.query.type
      const type =
        rawType === 'poster' || rawType === 'backdrop' ? rawType : 'all'

      const result = await downloadShowArtwork(req.params.id, type)
      return reply.send(result)
    },
  )

  // GET /api/artwork/movies/:id/images — TMDB image candidates
  app.get<{ Params: { id: string } }>('/artwork/movies/:id/images', async (req, reply) => {
    if (!config.TMDB_API_KEY) return reply.code(422).send({ error: 'TMDB_API_KEY not configured' })

    const movie = await prisma.movie.findUnique({ where: { id: req.params.id } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })
    if (!movie.tmdbId) return reply.code(422).send({ error: 'Movie has no TMDB ID — match it first' })

    const images = await searchMovieImages(config.TMDB_API_KEY, movie.tmdbId)
    return reply.send(images)
  })

  // GET /api/artwork/shows/:id/images
  app.get<{ Params: { id: string } }>('/artwork/shows/:id/images', async (req, reply) => {
    if (!config.TMDB_API_KEY) return reply.code(422).send({ error: 'TMDB_API_KEY not configured' })

    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })
    if (!show.tmdbId) return reply.code(422).send({ error: 'Show has no TMDB ID — match it first' })

    const images = await searchTvImages(config.TMDB_API_KEY, show.tmdbId)
    return reply.send(images)
  })

  // POST /api/artwork/movies/:id/select — user picks a specific image by filePath
  app.post<{
    Params: { id: string }
    Body: { filePath: string; artworkType: 'poster' | 'backdrop' }
  }>('/artwork/movies/:id/select', async (req, reply) => {
    const movie = await prisma.movie.findUnique({
      where: { id: req.params.id },
      include: { files: { take: 1 } },
    })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })

    const firstFile = movie.files[0]
    if (!firstFile) return reply.code(422).send({ error: 'No files found for this movie' })

    const { filePath, artworkType } = req.body
    const url = tmdbImageUrl(filePath, 'original')
    const filename = artworkType === 'poster' ? 'poster.jpg' : 'backdrop.jpg'
    const destPath = path.join(path.dirname(firstFile.path), filename)

    const saved = await saveImage(url, destPath)
    if (!saved) return reply.code(500).send({ error: 'Failed to download image' })

    await prisma.movie.update({
      where: { id: req.params.id },
      data: {
        [artworkType === 'poster' ? 'posterUrl' : 'backdropUrl']: url,
        [artworkType === 'poster' ? 'posterDownloaded' : 'backdropDownloaded']: true,
      },
    })

    return reply.send({ saved: true, path: destPath })
  })

  // POST /api/artwork/shows/:id/select — same for shows
  app.post<{
    Params: { id: string }
    Body: { filePath: string; artworkType: 'poster' | 'backdrop' }
  }>('/artwork/shows/:id/select', async (req, reply) => {
    const show = await prisma.tvShow.findUnique({
      where: { id: req.params.id },
      include: {
        seasons: {
          include: { episodes: { include: { files: { take: 1 } }, take: 1 } },
          take: 1,
        },
      },
    })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    const firstFile = show.seasons[0]?.episodes[0]?.files[0]
    if (!firstFile) return reply.code(422).send({ error: 'No files found for this show' })

    const { filePath, artworkType } = req.body
    const url = tmdbImageUrl(filePath, 'original')
    const showFolder = path.dirname(path.dirname(firstFile.path))
    const filename = artworkType === 'poster' ? 'poster.jpg' : 'backdrop.jpg'
    const destPath = path.join(showFolder, filename)

    const saved = await saveImage(url, destPath)
    if (!saved) return reply.code(500).send({ error: 'Failed to download image' })

    await prisma.tvShow.update({
      where: { id: req.params.id },
      data: {
        [artworkType === 'poster' ? 'posterUrl' : 'backdropUrl']: url,
        [artworkType === 'poster' ? 'posterDownloaded' : 'backdropDownloaded']: true,
      },
    })

    return reply.send({ saved: true, path: destPath })
  })
}

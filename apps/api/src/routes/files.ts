import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import {
  previewMovieRenames,
  applyMovieRenames,
  previewEpisodeRenames,
  applyEpisodeRenames,
  deleteToTrash,
  type RenamePreviewItem,
} from '../files/rename.js'
import { detectMultiPartMovies, mergeMovieParts } from '../files/merge.js'
import { triggerLibraryRefresh } from '../jellyfin/sync.js'

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/files/rename-preview?type=movies|episodes&ids=id1,id2,...
  app.get<{
    Querystring: { type?: 'movies' | 'episodes'; ids?: string }
  }>('/files/rename-preview', async (req, reply) => {
    const { type = 'movies', ids } = req.query
    const idList = ids ? ids.split(',').filter(Boolean) : undefined

    const items =
      type === 'episodes'
        ? await previewEpisodeRenames(idList)
        : await previewMovieRenames(idList)

    return reply.send(items)
  })

  // POST /api/files/rename — apply renames
  // body: { type: 'movies' | 'episodes'; fileIds: string[]; showFolderItems?: RenamePreviewItem[] }
  app.post<{
    Body: { type?: 'movies' | 'episodes'; fileIds: string[]; showFolderItems?: RenamePreviewItem[] }
  }>('/files/rename', async (req, reply) => {
    const { type = 'movies', fileIds, showFolderItems } = req.body
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return reply.code(400).send({ error: 'fileIds must be a non-empty array' })
    }

    const result =
      type === 'episodes'
        ? await applyEpisodeRenames(fileIds, showFolderItems)
        : await applyMovieRenames(fileIds)

    if (result.renamed > 0) {
      triggerLibraryRefresh(app.log).catch(() => {})
    }

    return reply.send(result)
  })

  // GET /api/files/episode-files — list all episode files with current mapping for remap UI
  app.get('/files/episode-files', async (_req, reply) => {
    const files = await prisma.episodeFile.findMany({
      select: {
        id: true,
        path: true,
        multiEpisodeEnd: true,
        episode: {
          select: {
            episodeNumber: true,
            title: true,
            season: {
              select: {
                seasonNumber: true,
                show: { select: { id: true, title: true } },
              },
            },
          },
        },
      },
      orderBy: [
        { episode: { season: { show: { title: 'asc' } } } },
        { episode: { season: { seasonNumber: 'asc' } } },
        { episode: { episodeNumber: 'asc' } },
      ],
    })
    return reply.send(files)
  })

  // POST /api/files/episode-remap — reassign an episode file to a different episode (or multi-episode range)
  app.post<{
    Body: {
      fileId: string
      showId: string
      seasonNumber: number
      episodeStart: number
      episodeEnd?: number
    }
  }>('/files/episode-remap', async (req, reply) => {
    const { fileId, showId, seasonNumber, episodeStart, episodeEnd } = req.body
    if (!fileId || !showId || seasonNumber == null || episodeStart == null) {
      return reply.code(400).send({ error: 'fileId, showId, seasonNumber, episodeStart are required' })
    }

    // Find or create the target season
    let season = await prisma.season.findFirst({ where: { showId, seasonNumber } })
    if (!season) {
      season = await prisma.season.create({
        data: { showId, seasonNumber, episodeCount: 0 },
      })
    }

    // Find or create the start episode
    let episode = await prisma.episode.findFirst({
      where: { seasonId: season.id, episodeNumber: episodeStart },
    })
    if (!episode) {
      episode = await prisma.episode.create({
        data: { seasonId: season.id, episodeNumber: episodeStart, status: 'owned' },
      })
    }

    // Update the file
    const updated = await prisma.episodeFile.update({
      where: { id: fileId },
      data: {
        episodeId: episode.id,
        multiEpisodeEnd: episodeEnd ?? null,
      },
      include: { episode: { include: { season: { include: { show: true } } } } },
    })

    // Mark all covered episodes as owned when episodeEnd is set
    if (episodeEnd !== null && episodeEnd !== undefined && episodeEnd > episodeStart) {
      const eps = await prisma.episode.findMany({
        where: {
          seasonId: season.id,
          episodeNumber: { gte: episodeStart, lte: episodeEnd },
        },
      })
      await prisma.episode.updateMany({
        where: { id: { in: eps.map((e) => e.id) } },
        data: { status: 'owned' },
      })
    }

    return reply.send(updated)
  })

  // GET /api/files/multi-part — detect movies split into two part files
  app.get('/files/multi-part', async (_req, reply) => {
    const candidates = await detectMultiPartMovies()
    return reply.send(candidates)
  })

  // POST /api/files/merge-parts — concat two part files via ffmpeg
  app.post<{ Body: { movieId: string } }>('/files/merge-parts', async (req, reply) => {
    const { movieId } = req.body
    if (!movieId) return reply.code(400).send({ error: 'movieId is required' })

    const result = await mergeMovieParts(movieId)

    if ('outputPath' in result) {
      triggerLibraryRefresh(app.log).catch(() => {})
    }

    return reply.send(result)
  })

  // GET /api/files/stale — unresolved stale files from scan logs
  app.get<{
    Querystring: { limit?: string; offset?: string }
  }>('/files/stale', async (req, reply) => {
    const limit = Math.min(Number(req.query.limit ?? 100), 500)
    const offset = Number(req.query.offset ?? 0)

    const [items, total] = await Promise.all([
      prisma.staleFile.findMany({
        where: { resolved: false },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { scanLog: { select: { startedAt: true } } },
      }),
      prisma.staleFile.count({ where: { resolved: false } }),
    ])

    return reply.send({ items, total })
  })

  // DELETE /api/files/stale/:id — move to .trash/ and mark resolved
  app.delete<{ Params: { id: string } }>('/files/stale/:id', async (req, reply) => {
    const stale = await prisma.staleFile.findUnique({ where: { id: req.params.id } })
    if (!stale) return reply.code(404).send({ error: 'Stale file not found' })

    try {
      await deleteToTrash(stale.path)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      app.log.warn(`Could not delete stale file ${stale.path}: ${msg}`)
    }

    await prisma.staleFile.update({ where: { id: req.params.id }, data: { resolved: true } })
    return reply.code(204).send()
  })

  // PATCH /api/files/stale/:id/resolve — mark resolved without deleting
  app.patch<{ Params: { id: string } }>('/files/stale/:id/resolve', async (req, reply) => {
    const stale = await prisma.staleFile.findUnique({ where: { id: req.params.id } })
    if (!stale) return reply.code(404).send({ error: 'Stale file not found' })

    await prisma.staleFile.update({ where: { id: req.params.id }, data: { resolved: true } })
    return reply.code(204).send()
  })

  // POST /api/files/stale/bulk-delete — delete multiple stale files
  app.post<{ Body: { ids: string[] } }>('/files/stale/bulk-delete', async (req, reply) => {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: 'ids must be a non-empty array' })
    }

    const staleFiles = await prisma.staleFile.findMany({
      where: { id: { in: ids }, resolved: false },
    })

    let deleted = 0
    const errors: string[] = []

    for (const stale of staleFiles) {
      try {
        await deleteToTrash(stale.path)
        deleted++
      } catch (err) {
        errors.push(`${stale.path}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    await prisma.staleFile.updateMany({
      where: { id: { in: staleFiles.map((f) => f.id) } },
      data: { resolved: true },
    })

    return reply.send({ deleted, errors })
  })
}

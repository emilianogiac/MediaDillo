import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import {
  previewMovieRenames,
  applyMovieRenames,
  previewEpisodeRenames,
  previewEpisodeFileRenames,
  applyEpisodeRenames,
  revertRenameLog,
  deleteToTrash,
  type RenamePreviewItem,
} from '../files/rename.js'
import { detectMultiPartMovies, mergeMovieParts } from '../files/merge.js'
import { triggerLibraryRefresh } from '../jellyfin/sync.js'
import { createJob, tickJob, failJob, finishJob } from '../health/job-tracker.js'

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/files/rename-preview?type=movies|episodes|episode-files&ids=id1,id2,...
  app.get<{
    Querystring: { type?: 'movies' | 'episodes' | 'episode-files'; ids?: string }
  }>('/files/rename-preview', async (req, reply) => {
    const { type = 'movies', ids } = req.query
    const idList = ids ? ids.split(',').filter(Boolean) : undefined

    const items =
      type === 'episode-files'
        ? await previewEpisodeFileRenames(idList ?? [])
        : type === 'episodes'
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
        : await applyMovieRenames(fileIds, 'manual')

    if (result.renamed > 0) {
      triggerLibraryRefresh(app.log).catch(() => {})
    }

    return reply.send(result)
  })

  // POST /api/files/rename-batch — background job rename for selected movies
  app.post<{ Body: { movieIds: string[] } }>('/files/rename-batch', async (req, reply) => {
    const { movieIds = [] } = req.body
    if (movieIds.length === 0) {
      return reply.code(400).send({ error: 'No movies provided' })
    }

    // Preview to find which movies actually need renaming; group file IDs by movie
    const previews = await previewMovieRenames(movieIds)
    const byMovie = new Map<string, { title: string; fileIds: string[] }>()

    // Load titles for error messages
    const movies = await prisma.movie.findMany({
      where: { id: { in: movieIds } },
      select: { id: true, title: true },
    })
    const titleMap = new Map(movies.map((m) => [m.id, m.title]))

    // Load files to get movieId per fileId
    const needsRenameFileIds = previews.filter((p) => p.needsRename).map((p) => p.id)
    if (needsRenameFileIds.length === 0) {
      return reply.send({ jobId: null, total: 0, message: 'All files are already canonical' })
    }

    const files = await prisma.movieFile.findMany({
      where: { id: { in: needsRenameFileIds } },
      select: { id: true, movieId: true },
    })
    for (const f of files) {
      if (!byMovie.has(f.movieId)) {
        byMovie.set(f.movieId, { title: titleMap.get(f.movieId) ?? f.movieId, fileIds: [] })
      }
      byMovie.get(f.movieId)!.fileIds.push(f.id)
    }

    const entries = [...byMovie.entries()]
    const job = createJob(entries.length)

    const run = async () => {
      let anyRenamed = false
      for (const [, { title, fileIds }] of entries) {
        try {
          const result = await applyMovieRenames(fileIds, 'manual')
          if (result.renamed > 0) anyRenamed = true
          if (result.errors.length > 0) {
            for (const e of result.errors) failJob(job.id, `"${title}": ${e}`)
          }
        } catch (err) {
          failJob(job.id, `"${title}": ${err instanceof Error ? err.message : String(err)}`)
        }
        tickJob(job.id)
      }
      if (anyRenamed) triggerLibraryRefresh(app.log).catch(() => {})
      finishJob(job.id)
    }

    run().catch((err: unknown) => {
      app.log.error(err, 'Batch rename failed')
      finishJob(job.id)
    })

    return reply.code(202).send({ jobId: job.id, total: entries.length })
  })

  // POST /api/files/rename-batch/shows — background job rename for selected shows
  app.post<{ Body: { showIds: string[] } }>('/files/rename-batch/shows', async (req, reply) => {
    const { showIds = [] } = req.body
    if (showIds.length === 0) {
      return reply.code(400).send({ error: 'No shows provided' })
    }

    const previews = await previewEpisodeRenames(showIds)
    const needsRenameFiles = previews.filter((p) => p.needsRename && p.type === 'episode-file')
    // show-folder items: id === showId
    const folderByShowId = new Map(
      previews.filter((p) => p.needsRename && p.type === 'show-folder').map((p) => [p.id, p]),
    )

    if (needsRenameFiles.length === 0 && folderByShowId.size === 0) {
      return reply.send({ jobId: null, total: 0, message: 'All episode files and folders are already canonical' })
    }

    // Group file IDs by show
    const shows = await prisma.tvShow.findMany({
      where: { id: { in: showIds } },
      select: { id: true, title: true },
    })
    const titleMap = new Map(shows.map((s) => [s.id, s.title]))

    const fileIds = needsRenameFiles.map((p) => p.id)
    const files = await prisma.episodeFile.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, episode: { select: { season: { select: { showId: true } } } } },
    })

    const byShow = new Map<string, { title: string; fileIds: string[]; folderItem?: RenamePreviewItem }>()
    for (const f of files) {
      const showId = f.episode.season.showId
      if (!byShow.has(showId)) {
        byShow.set(showId, { title: titleMap.get(showId) ?? showId, fileIds: [] })
      }
      byShow.get(showId)!.fileIds.push(f.id)
    }
    // Include shows that only need a folder rename (no file renames)
    for (const [showId, folderItem] of folderByShowId) {
      if (!byShow.has(showId)) {
        byShow.set(showId, { title: titleMap.get(showId) ?? showId, fileIds: [] })
      }
      byShow.get(showId)!.folderItem = folderItem
    }
    // Attach folder items to shows that also have file renames
    for (const [showId, entry] of byShow) {
      const fi = folderByShowId.get(showId)
      if (!entry.folderItem && fi) {
        entry.folderItem = fi
      }
    }

    const entries = [...byShow.entries()]
    const job = createJob(entries.length)

    const run = async () => {
      for (const [, { title, fileIds: ids, folderItem }] of entries) {
        try {
          const result = await applyEpisodeRenames(ids, folderItem ? [folderItem] : undefined)
          if (result.errors.length > 0) {
            for (const e of result.errors) failJob(job.id, `"${title}": ${e}`)
          }
        } catch (err) {
          failJob(job.id, `"${title}": ${err instanceof Error ? err.message : String(err)}`)
        }
        tickJob(job.id)
      }
      triggerLibraryRefresh(app.log).catch(() => {})
      finishJob(job.id)
    }

    run().catch((err: unknown) => {
      app.log.error(err, 'Batch show rename failed')
      finishJob(job.id)
    })

    return reply.code(202).send({ jobId: job.id, total: entries.length })
  })

  // GET /api/files/rename-log?movieId=xxx
  app.get<{ Querystring: { movieId?: string } }>('/files/rename-log', async (req, reply) => {
    const { movieId } = req.query
    const logs = await prisma.renameLog.findMany({
      where: { ...(movieId ? { movieId } : {}), expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return reply.send(logs)
  })

  // POST /api/files/rename-log/:id/revert — undo a rename by moving the file back
  app.post<{ Params: { id: string } }>('/files/rename-log/:id/revert', async (req, reply) => {
    const result = await revertRenameLog(req.params.id)
    if (!result.ok) return reply.code(400).send({ error: result.error })
    triggerLibraryRefresh(app.log).catch(() => {})
    return reply.send({ ok: true })
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

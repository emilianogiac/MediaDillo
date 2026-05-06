import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import {
  previewMovieRenames,
  applyMovieRenames,
  previewEpisodeRenames,
  applyEpisodeRenames,
  deleteToTrash,
} from '../files/rename.js'

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
  // body: { type: 'movies' | 'episodes'; fileIds: string[] }
  app.post<{
    Body: { type?: 'movies' | 'episodes'; fileIds: string[] }
  }>('/files/rename', async (req, reply) => {
    const { type = 'movies', fileIds } = req.body
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return reply.code(400).send({ error: 'fileIds must be a non-empty array' })
    }

    const result =
      type === 'episodes'
        ? await applyEpisodeRenames(fileIds)
        : await applyMovieRenames(fileIds)

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

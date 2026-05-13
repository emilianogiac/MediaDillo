import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { pruneExpiredActivityLogs } from '../activity/log.js'
import { revertActivityEntries } from '../activity/revert.js'

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/activity?action=rename,cleanup&movieId=x&showId=y&limit=50&offset=0
  app.get<{
    Querystring: {
      action?: string
      movieId?: string
      showId?: string
      limit?: string
      offset?: string
    }
  }>('/activity', async (req, reply) => {
    await pruneExpiredActivityLogs()
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200)
    const offset = parseInt(req.query.offset ?? '0', 10)
    const actions = req.query.action?.split(',').filter(Boolean)

    const where = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(actions?.length ? { action: { in: actions as any[] } } : {}),
      ...(req.query.movieId ? { movieId: req.query.movieId } : {}),
      ...(req.query.showId ? { showId: req.query.showId } : {}),
    }

    const [items, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.activityLog.count({ where }),
    ])

    return reply.send({ items, total })
  })

  // POST /api/activity/revert — revert one or more entries
  app.post<{ Body: { ids: string[] } }>('/activity/revert', async (req, reply) => {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: 'ids must be a non-empty array' })
    }
    const result = await revertActivityEntries(ids)
    return reply.send(result)
  })
}

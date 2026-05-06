import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { getSchedule, setSchedule } from '../scheduler/index.js'
import type { ScheduleInterval } from '../scheduler/index.js'

const VALID_INTERVALS = new Set<ScheduleInterval>(['disabled', '1h', '6h', '12h', '24h'])

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/settings/schedule
  app.get('/settings/schedule', async (_req, reply) => {
    const schedule = await getSchedule()
    return reply.send({ schedule })
  })

  // PUT /api/settings/schedule
  app.put<{ Body: { schedule: string } }>('/settings/schedule', async (req, reply) => {
    const { schedule } = req.body
    if (!VALID_INTERVALS.has(schedule as ScheduleInterval)) {
      return reply.code(400).send({ error: `Invalid schedule. Valid values: ${[...VALID_INTERVALS].join(', ')}` })
    }
    await setSchedule(schedule as ScheduleInterval)
    return reply.send({ schedule })
  })

  // GET /api/settings/scan-roots — all roots (including disabled)
  app.get('/settings/scan-roots', async (_req, reply) => {
    const roots = await prisma.scanRoot.findMany({ orderBy: { label: 'asc' } })
    return reply.send(roots)
  })

  // POST /api/settings/scan-roots
  app.post<{
    Body: { path: string; label: string; type: 'movies' | 'tv' }
  }>('/settings/scan-roots', async (req, reply) => {
    const { path, label, type } = req.body
    if (!path || !label || !type) {
      return reply.code(400).send({ error: 'path, label, and type are required' })
    }
    const existing = await prisma.scanRoot.findUnique({ where: { path } })
    if (existing) return reply.code(409).send({ error: 'A scan root with this path already exists' })

    const root = await prisma.scanRoot.create({ data: { path, label, type, enabled: true } })
    return reply.code(201).send(root)
  })

  // PATCH /api/settings/scan-roots/:id
  app.patch<{
    Params: { id: string }
    Body: { label?: string; type?: 'movies' | 'tv'; enabled?: boolean }
  }>('/settings/scan-roots/:id', async (req, reply) => {
    const root = await prisma.scanRoot.findUnique({ where: { id: req.params.id } })
    if (!root) return reply.code(404).send({ error: 'Scan root not found' })

    const updated = await prisma.scanRoot.update({
      where: { id: req.params.id },
      data: req.body,
    })
    return reply.send(updated)
  })

  // DELETE /api/settings/scan-roots/:id
  app.delete<{ Params: { id: string } }>('/settings/scan-roots/:id', async (req, reply) => {
    const root = await prisma.scanRoot.findUnique({ where: { id: req.params.id } })
    if (!root) return reply.code(404).send({ error: 'Scan root not found' })
    await prisma.scanRoot.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // GET /api/settings/scan-logs — recent scan history
  app.get<{ Querystring: { limit?: string } }>('/settings/scan-logs', async (req, reply) => {
    const limit = Math.min(Number(req.query.limit ?? 10), 50)
    const logs = await prisma.scanLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        rootsScanned: true,
        filesAdded: true,
        filesChanged: true,
        filesRemoved: true,
        staleFilesFound: true,
      },
    })
    return reply.send(logs)
  })
}

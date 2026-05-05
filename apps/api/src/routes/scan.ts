import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { runScan, isScanRunning } from '../scanner/index.js'
import { config } from '../config.js'

export async function scanRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/scan — trigger a full library scan
  app.post('/scan', async (_req, reply) => {
    if (isScanRunning()) {
      return reply.code(409).send({ error: 'Scan already in progress' })
    }

    if (config.SCAN_ROOTS.length === 0) {
      return reply.code(422).send({ error: 'No scan roots configured. Set SCAN_ROOTS env var.' })
    }

    // Fire scan in background and return immediately
    const startedAt = new Date().toISOString()
    runScan(config.SCAN_ROOTS).catch((err: unknown) => {
      app.log.error(err, 'Scan failed')
    })

    return reply.code(202).send({
      message: 'Scan started',
      startedAt,
      roots: config.SCAN_ROOTS.map((r) => r.label),
    })
  })

  // GET /api/scan/status — is a scan running?
  app.get('/scan/status', async (_req, reply) => {
    return reply.send({ scanning: isScanRunning() })
  })

  // GET /api/scan/logs — list scan history
  app.get('/scan/logs', async (_req, reply) => {
    const logs = await prisma.scanLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
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

  // GET /api/scan/logs/:id — single log with stale files
  app.get<{ Params: { id: string } }>('/scan/logs/:id', async (req, reply) => {
    const log = await prisma.scanLog.findUnique({
      where: { id: req.params.id },
      include: { staleFiles: true },
    })
    if (!log) return reply.code(404).send({ error: 'Scan log not found' })
    return reply.send(log)
  })
}

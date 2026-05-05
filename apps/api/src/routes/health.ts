import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    let dbStatus: 'ok' | 'error' = 'ok'

    try {
      await prisma.$queryRaw`SELECT 1`
    } catch {
      dbStatus = 'error'
    }

    const status = dbStatus === 'ok' ? 200 : 503

    return reply.code(status).send({
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      db: dbStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    })
  })
}

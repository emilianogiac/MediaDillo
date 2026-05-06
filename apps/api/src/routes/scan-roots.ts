import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'

export async function scanRootsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/scan-roots', async (_req, reply) => {
    const roots = await prisma.scanRoot.findMany({
      where: { enabled: true },
      orderBy: { label: 'asc' },
      select: { id: true, label: true, type: true, path: true },
    })
    return reply.send(roots)
  })
}

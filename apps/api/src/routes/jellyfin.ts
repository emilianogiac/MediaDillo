import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { JellyfinClient, testJellyfinConnection } from '../jellyfin/client.js'
import { triggerLibraryRefresh } from '../jellyfin/sync.js'

function getClient(): JellyfinClient | null {
  if (!config.JELLYFIN_URL || !config.JELLYFIN_API_KEY) return null
  return new JellyfinClient(config.JELLYFIN_URL, config.JELLYFIN_API_KEY)
}

export async function jellyfinRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/jellyfin/status — connection status
  app.get('/jellyfin/status', async (_req, reply) => {
    if (!config.JELLYFIN_URL || !config.JELLYFIN_API_KEY) {
      return reply.send({ configured: false, connected: false })
    }
    const status = await testJellyfinConnection(config.JELLYFIN_URL, config.JELLYFIN_API_KEY)
    return reply.send(status)
  })

  // POST /api/jellyfin/refresh — manual library refresh
  app.post('/jellyfin/refresh', async (_req, reply) => {
    const client = getClient()
    if (!client) {
      return reply.code(422).send({ error: 'Jellyfin is not configured' })
    }
    try {
      await client.triggerLibraryRefresh()
      return reply.send({ ok: true })
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // GET /api/jellyfin/watched — watched movie TMDB IDs + episode file paths
  app.get('/jellyfin/watched', async (_req, reply) => {
    const client = getClient()
    if (!client) {
      return reply.send({ configured: false, movieTmdbIds: [], episodePaths: [] })
    }
    try {
      const users = await client.getUsers()
      const userId = users[0]?.Id
      if (!userId) {
        return reply.send({ configured: true, movieTmdbIds: [], episodePaths: [] })
      }
      const [movieTmdbIds, episodePaths] = await Promise.all([
        client.getWatchedMovieTmdbIds(userId),
        client.getWatchedEpisodePaths(userId),
      ])
      return reply.send({ configured: true, movieTmdbIds, episodePaths })
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /api/jellyfin/trigger-refresh — alias for use after scan completes
  app.post('/jellyfin/trigger-refresh', async (_req, reply) => {
    await triggerLibraryRefresh(app.log)
    return reply.send({ ok: true })
  })
}

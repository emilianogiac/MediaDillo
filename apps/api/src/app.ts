import Fastify from 'fastify'
import cors from '@fastify/cors'
import staticPlugin from '@fastify/static'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { healthRoutes } from './routes/health.js'
import { scanRoutes } from './routes/scan.js'
import { metadataRoutes } from './routes/metadata.js'
import { artworkRoutes } from './routes/artwork.js'
import { moviesRoutes } from './routes/movies.js'
import { showsRoutes } from './routes/shows.js'
import { scanRootsRoutes } from './routes/scan-roots.js'
import { config } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function buildApp() {
  const app = Fastify({
    logger:
      config.NODE_ENV !== 'production'
        ? {
            level: 'debug',
            transport: { target: 'pino-pretty', options: { colorize: true } },
          }
        : { level: 'info' },
  })

  await app.register(cors, {
    origin: config.NODE_ENV === 'development' ? true : false,
  })

  // Serve static frontend in production
  if (config.NODE_ENV === 'production') {
    const publicDir = path.join(__dirname, '..', 'public')
    await app.register(staticPlugin, {
      root: publicDir,
      prefix: '/',
    })
  }

  // API routes
  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(scanRoutes, { prefix: '/api' })
  await app.register(metadataRoutes, { prefix: '/api' })
  await app.register(artworkRoutes, { prefix: '/api' })
  await app.register(moviesRoutes, { prefix: '/api' })
  await app.register(showsRoutes, { prefix: '/api' })
  await app.register(scanRootsRoutes, { prefix: '/api' })

  // SPA fallback in production
  if (config.NODE_ENV === 'production') {
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html')
    })
  }

  return app
}

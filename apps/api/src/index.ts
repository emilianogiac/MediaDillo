import { buildApp } from './app.js'
import { config } from './config.js'

const app = await buildApp()

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  console.log(`MediaDillo API running on port ${config.PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

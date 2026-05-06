import { buildApp } from './app.js'
import { config } from './config.js'
import { initScheduler } from './scheduler/index.js'
import { seedScanRootsFromEnv } from './scanner/seed.js'

const app = await buildApp()

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  console.log(`MediaDillo API running on port ${config.PORT}`)
  await seedScanRootsFromEnv(config.SCAN_ROOTS)
  await initScheduler()
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

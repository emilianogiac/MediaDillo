import { buildApp } from './app.js'
import { config } from './config.js'
import { initScheduler } from './scheduler/index.js'
import { seedScanRootsFromEnv } from './scanner/seed.js'
import { seedApiConfigFromEnv } from './api-config.js'
import { migrateRenameLogs } from './activity/migrate-rename-log.js'

const app = await buildApp()

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  console.log(`MediaDillo API running on port ${config.PORT}`)
  await seedScanRootsFromEnv(config.SCAN_ROOTS)
  await seedApiConfigFromEnv()
  await initScheduler()
  await migrateRenameLogs()
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

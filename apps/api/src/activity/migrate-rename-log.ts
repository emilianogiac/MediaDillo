import { prisma } from '@mediadillo/db'

const TTL_MS = 180 * 24 * 60 * 60 * 1000
const MIGRATION_KEY = 'activity_log_migration_done'

export async function migrateRenameLogs(): Promise<void> {
  const alreadyRun = await prisma.setting.findUnique({ where: { key: MIGRATION_KEY } })
  if (alreadyRun) return

  const logs = await prisma.renameLog.findMany()
  for (const log of logs) {
    await prisma.activityLog.create({
      data: {
        action: 'rename',
        ...(log.movieId ? { movieId: log.movieId } : {}),
        fromPath: log.fromPath,
        toPath: log.toPath,
        createdAt: log.createdAt,
        expiresAt: new Date(Date.now() + TTL_MS),
        detail: { trigger: log.trigger, migratedFromRenameLog: true },
      },
    })
  }

  await prisma.setting.create({ data: { key: MIGRATION_KEY, value: 'true' } })
}

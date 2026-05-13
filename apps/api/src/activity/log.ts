import { prisma } from '@mediadillo/db'
import type { ActivityAction, Prisma } from '@mediadillo/db'

const TTL_MS = 180 * 24 * 60 * 60 * 1000

export interface ActivityLogOpts {
  action: ActivityAction
  movieId?: string
  showId?: string
  episodeId?: string
  fromPath?: string
  toPath?: string
  filePath?: string
  detail?: Prisma.InputJsonValue
  revertOfId?: string
}

export async function logActivity(opts: ActivityLogOpts): Promise<string> {
  const entry = await prisma.activityLog.create({
    data: {
      ...opts,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  })
  return entry.id
}

export async function pruneExpiredActivityLogs(): Promise<void> {
  await prisma.activityLog.deleteMany({ where: { expiresAt: { lt: new Date() } } })
}

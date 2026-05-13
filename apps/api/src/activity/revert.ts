import { prisma } from '@mediadillo/db'
import fs from 'node:fs/promises'
import path from 'node:path'
import { logActivity } from './log.js'

export async function revertActivityEntries(
  ids: string[],
): Promise<{ ok: string[]; failed: { id: string; error: string }[] }> {
  const ok: string[] = []
  const failed: { id: string; error: string }[] = []

  for (const id of ids) {
    const entry = await prisma.activityLog.findUnique({ where: { id } })
    if (!entry) { failed.push({ id, error: 'Not found' }); continue }
    if (entry.revertedAt) { failed.push({ id, error: 'Already reverted' }); continue }
    if (!['rename', 'collection_move'].includes(entry.action)) {
      failed.push({ id, error: `Action ${entry.action} cannot be reverted` }); continue
    }
    if (!entry.fromPath || !entry.toPath) {
      failed.push({ id, error: 'Missing path info' }); continue
    }

    try {
      await fs.access(entry.toPath)
      await fs.mkdir(path.dirname(entry.fromPath), { recursive: true })
      await fs.rename(entry.toPath, entry.fromPath)

      await prisma.activityLog.update({
        where: { id },
        data: { revertedAt: new Date() },
      })

      // Update the DB file record if applicable
      if (entry.movieId) {
        await prisma.movieFile.updateMany({
          where: { path: entry.toPath },
          data: { path: entry.fromPath },
        })
      }
      if (entry.episodeId || entry.showId) {
        await prisma.episodeFile.updateMany({
          where: { path: entry.toPath },
          data: { path: entry.fromPath },
        })
      }

      await logActivity({
        action: entry.action,
        ...(entry.movieId ? { movieId: entry.movieId } : {}),
        ...(entry.showId ? { showId: entry.showId } : {}),
        ...(entry.episodeId ? { episodeId: entry.episodeId } : {}),
        fromPath: entry.toPath,
        toPath: entry.fromPath,
        detail: { trigger: 'revert' },
        revertOfId: id,
      })

      ok.push(id)
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { ok, failed }
}

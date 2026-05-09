import { JellyfinClient } from './client.js'
import { getApiConfig } from '../api-config.js'
import { prisma } from '@mediadillo/db'

export async function getJellyfinClient(): Promise<JellyfinClient | null> {
  const cfg = await getApiConfig()
  if (!cfg.jellyfinUrl || !cfg.jellyfinApiKey) return null
  return new JellyfinClient(cfg.jellyfinUrl, cfg.jellyfinApiKey)
}

export async function syncJellyfinIds(logger?: { warn: (msg: string) => void }): Promise<void> {
  const client = await getJellyfinClient()
  if (!client) return
  try {
    const users = await client.getUsers()
    const userId = users[0]?.Id
    if (!userId) return
    const movies = await client.getAllMoviesWithIds(userId)
    const knownTmdbIds: number[] = []
    for (const { jellyfinId, tmdbId } of movies) {
      if (!tmdbId || !jellyfinId) continue
      knownTmdbIds.push(tmdbId)
      await prisma.movie.updateMany({ where: { tmdbId }, data: { jellyfinId } })
    }
    // Clear stale jellyfinId for movies no longer in Jellyfin
    if (knownTmdbIds.length > 0) {
      await prisma.movie.updateMany({
        where: { jellyfinId: { not: null }, tmdbId: { notIn: knownTmdbIds } },
        data: { jellyfinId: null },
      })
    }
  } catch (err) {
    const msg = `Jellyfin ID sync failed: ${err instanceof Error ? err.message : String(err)}`
    if (logger) logger.warn(msg)
    else console.warn(msg)
  }
}

export async function triggerLibraryRefresh(logger?: { warn: (msg: string) => void }): Promise<void> {
  const client = await getJellyfinClient()
  if (!client) return

  try {
    await client.triggerLibraryRefresh()
  } catch (err) {
    const msg = `Jellyfin library refresh failed: ${err instanceof Error ? err.message : String(err)}`
    if (logger) logger.warn(msg)
    else console.warn(msg)
  }
}

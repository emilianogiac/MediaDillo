import { JellyfinClient } from './client.js'
import { config } from '../config.js'

export function getJellyfinClient(): JellyfinClient | null {
  if (!config.JELLYFIN_URL || !config.JELLYFIN_API_KEY) return null
  return new JellyfinClient(config.JELLYFIN_URL, config.JELLYFIN_API_KEY)
}

export async function triggerLibraryRefresh(logger?: { warn: (msg: string) => void }): Promise<void> {
  const client = getJellyfinClient()
  if (!client) return

  try {
    await client.triggerLibraryRefresh()
  } catch (err) {
    const msg = `Jellyfin library refresh failed: ${err instanceof Error ? err.message : String(err)}`
    if (logger) logger.warn(msg)
    else console.warn(msg)
  }
}

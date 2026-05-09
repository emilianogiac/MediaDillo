import { prisma } from '@mediadillo/db'
import { config } from './config.js'

export interface ApiConfig {
  tmdbApiKey: string | undefined
  tvdbApiKey: string | undefined
  jellyfinUrl: string | undefined
  jellyfinApiKey: string | undefined
  metadataLanguage: string
}

export const API_CONFIG_DB_KEYS = {
  tmdbApiKey: 'apiKey.tmdb',
  tvdbApiKey: 'apiKey.tvdb',
  jellyfinUrl: 'apiKey.jellyfinUrl',
  jellyfinApiKey: 'apiKey.jellyfinApiKey',
  metadataLanguage: 'apiKey.metadataLanguage',
} as const

let _cache: { value: ApiConfig; expiresAt: number } | null = null
const TTL_MS = 30_000

export function invalidateApiConfigCache(): void {
  _cache = null
}

export async function getApiConfig(): Promise<ApiConfig> {
  if (_cache && Date.now() < _cache.expiresAt) return _cache.value

  const dbKeys = Object.values(API_CONFIG_DB_KEYS)
  const rows = await prisma.setting.findMany({ where: { key: { in: dbKeys } } })
  const byKey: Record<string, string> = Object.fromEntries(rows.map((r) => [r.key, r.value]))

  const value: ApiConfig = {
    tmdbApiKey: byKey[API_CONFIG_DB_KEYS.tmdbApiKey] ?? config.TMDB_API_KEY,
    tvdbApiKey: byKey[API_CONFIG_DB_KEYS.tvdbApiKey] ?? config.TVDB_API_KEY,
    jellyfinUrl: byKey[API_CONFIG_DB_KEYS.jellyfinUrl] ?? config.JELLYFIN_URL,
    jellyfinApiKey: byKey[API_CONFIG_DB_KEYS.jellyfinApiKey] ?? config.JELLYFIN_API_KEY,
    metadataLanguage: byKey[API_CONFIG_DB_KEYS.metadataLanguage] ?? config.METADATA_LANGUAGE,
  }

  _cache = { value, expiresAt: Date.now() + TTL_MS }
  return value
}

export async function seedApiConfigFromEnv(): Promise<void> {
  const seeds: Array<[string, string | undefined]> = [
    [API_CONFIG_DB_KEYS.tmdbApiKey, config.TMDB_API_KEY],
    [API_CONFIG_DB_KEYS.tvdbApiKey, config.TVDB_API_KEY],
    [API_CONFIG_DB_KEYS.jellyfinUrl, config.JELLYFIN_URL],
    [API_CONFIG_DB_KEYS.jellyfinApiKey, config.JELLYFIN_API_KEY],
    [API_CONFIG_DB_KEYS.metadataLanguage, config.METADATA_LANGUAGE],
  ]
  for (const [key, value] of seeds) {
    if (!value) continue
    const existing = await prisma.setting.findUnique({ where: { key } })
    if (!existing) {
      await prisma.setting.create({ data: { key, value } })
    }
  }
}

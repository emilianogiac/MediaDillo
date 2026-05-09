import { apiFetch } from './client.js'

export interface JellyfinStatus {
  configured: boolean
  connected: boolean
  serverName?: string
  version?: string
  error?: string
}

export interface WatchedData {
  configured: boolean
  movieTmdbIds: number[]
  episodePaths: string[]
}

export async function fetchJellyfinStatus(): Promise<JellyfinStatus> {
  return apiFetch<JellyfinStatus>('/jellyfin/status')
}

export async function triggerJellyfinRefresh(): Promise<void> {
  await apiFetch('/jellyfin/refresh', { method: 'POST' })
}

export async function fetchWatchedData(): Promise<WatchedData> {
  return apiFetch<WatchedData>('/jellyfin/watched')
}

export async function fetchJellyfinMovieUrl(movieId: string): Promise<{ url: string }> {
  return apiFetch<{ url: string }>(`/jellyfin/item-url/${movieId}`)
}

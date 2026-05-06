import { apiFetch } from './client.js'

export interface LibraryStats {
  movies: number
  shows: number
  episodesOwned: number
  storageBytesStr: string
  healthIssues: number
  missingArt: number
  unmatched: number
  lastScan: {
    id: string
    startedAt: string
    finishedAt: string | null
    filesAdded: number
    filesChanged: number
    filesRemoved: number
    staleFilesFound: number
  } | null
}

export async function fetchStats(): Promise<LibraryStats> {
  return apiFetch<LibraryStats>('/stats')
}

export function formatBytes(bytesStr: string): string {
  const bytes = Number(BigInt(bytesStr))
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const unit = units[i] ?? 'TB'
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${unit}`
}

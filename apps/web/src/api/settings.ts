import { apiFetch } from './client.js'

export type ScheduleInterval = 'disabled' | '1h' | '6h' | '12h' | '24h'

export interface ScanRootRecord {
  id: string
  path: string
  label: string
  type: 'movies' | 'tv'
  enabled: boolean
  createdAt: string
}

export interface ScanLogRecord {
  id: string
  startedAt: string
  finishedAt: string | null
  rootsScanned: string[]
  filesAdded: number
  filesChanged: number
  filesRemoved: number
  staleFilesFound: number
}

export async function fetchSchedule(): Promise<ScheduleInterval> {
  const { schedule } = await apiFetch<{ schedule: ScheduleInterval }>('/settings/schedule')
  return schedule
}

export async function updateSchedule(schedule: ScheduleInterval): Promise<void> {
  await apiFetch('/settings/schedule', { method: 'PUT', body: JSON.stringify({ schedule }) })
}

export async function fetchAllScanRoots(): Promise<ScanRootRecord[]> {
  return apiFetch<ScanRootRecord[]>('/settings/scan-roots')
}

export async function createScanRoot(data: {
  path: string
  label: string
  type: 'movies' | 'tv'
}): Promise<ScanRootRecord> {
  return apiFetch<ScanRootRecord>('/settings/scan-roots', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateScanRoot(
  id: string,
  data: { label?: string; type?: 'movies' | 'tv'; enabled?: boolean },
): Promise<ScanRootRecord> {
  return apiFetch<ScanRootRecord>(`/settings/scan-roots/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteScanRoot(id: string): Promise<void> {
  await apiFetch(`/settings/scan-roots/${id}`, { method: 'DELETE' })
}

export async function fetchScanLogs(limit = 10): Promise<ScanLogRecord[]> {
  return apiFetch<ScanLogRecord[]>(`/settings/scan-logs?limit=${limit}`)
}

export interface DedupConflict {
  title: string
  canonicalId: string
  duplicateId: string
  reason: 'episode-collision'
  collisions: { seasonNumber: number; episodeNumber: number }[]
}

export interface DedupResult {
  merged: number
  deleted: number
  conflicts: DedupConflict[]
}

export async function dedupShows(): Promise<DedupResult> {
  return apiFetch<DedupResult>('/settings/dedup-shows', { method: 'POST' })
}

export interface KeyTestResult {
  valid: boolean
  error?: string
}

/**
 * Check a TVDB key without saving it (#66), so the user can verify what they
 * typed before committing to it.
 */
export async function testTvdbKey(apiKey: string): Promise<KeyTestResult> {
  return apiFetch<KeyTestResult>('/settings/api-keys/test-tvdb', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  })
}

export async function verifyIntegrity(): Promise<{ moviesRemoved: number; showsRemoved: number; episodesLost: number }> {
  return apiFetch<{ moviesRemoved: number; showsRemoved: number; episodesLost: number }>('/settings/verify-integrity', { method: 'POST' })
}


export async function fetchAutoCleanup(): Promise<boolean> {
  const r = await apiFetch<{ enabled: boolean }>('/settings/auto-cleanup')
  return r.enabled
}

export async function updateAutoCleanup(enabled: boolean): Promise<void> {
  await apiFetch('/settings/auto-cleanup', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}

export interface ApiKeySettings {
  tmdbApiKey: string
  tvdbApiKey: string
  jellyfinUrl: string
  jellyfinApiKey: string
  metadataLanguage: string
}

export async function fetchApiKeys(): Promise<ApiKeySettings> {
  return apiFetch<ApiKeySettings>('/settings/api-keys')
}

export async function updateApiKeys(
  data: Partial<ApiKeySettings>,
): Promise<void> {
  await apiFetch('/settings/api-keys', { method: 'PUT', body: JSON.stringify(data) })
}

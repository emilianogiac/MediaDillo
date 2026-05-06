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

export async function fetchScanLogs(): Promise<ScanLogRecord[]> {
  return apiFetch<ScanLogRecord[]>('/settings/scan-logs')
}

export async function dedupShows(): Promise<{ merged: number; deleted: number }> {
  return apiFetch<{ merged: number; deleted: number }>('/settings/dedup-shows', { method: 'POST' })
}

import { apiFetch } from './client.js'

export interface HealthItem {
  id: string
  type: 'movie' | 'show'
  title: string
  year: number | null
  posterDownloaded: boolean
  backdropDownloaded: boolean
  matched: boolean
  metadataComplete: boolean
  hasFiles: boolean
  score: number
}

export interface HealthSummary {
  missingPoster: number
  missingBackdrop: number
  unmatched: number
  noFiles: number
}

export interface JobStatus {
  id: string
  running: boolean
  total: number
  done: number
  errors: string[]
  startedAt: string
  finishedAt: string | null
}

export interface HealthFilter {
  type?: 'movies' | 'shows' | 'all'
  missingPoster?: boolean
  missingBackdrop?: boolean
  unmatched?: boolean
  noFiles?: boolean
  incomplete?: boolean
}

export async function fetchHealthItems(filter: HealthFilter = {}): Promise<HealthItem[]> {
  const params = new URLSearchParams()
  if (filter.type) params.set('type', filter.type)
  if (filter.missingPoster) params.set('missingPoster', 'true')
  if (filter.missingBackdrop) params.set('missingBackdrop', 'true')
  if (filter.unmatched) params.set('unmatched', 'true')
  if (filter.noFiles) params.set('noFiles', 'true')
  if (filter.incomplete) params.set('incomplete', 'true')
  const qs = params.toString()
  return apiFetch<HealthItem[]>(`/library-health/items${qs ? `?${qs}` : ''}`)
}

export async function fetchHealthSummary(): Promise<HealthSummary> {
  return apiFetch<HealthSummary>('/library-health/summary')
}

export async function startBulkArtworkDownload(
  type: 'movies' | 'shows' | 'all' = 'all',
): Promise<{ jobId: string | null; total?: number; message?: string }> {
  return apiFetch('/library-health/artwork/bulk-download', {
    method: 'POST',
    body: JSON.stringify({ type }),
  })
}

export async function fetchJobStatus(jobId: string): Promise<JobStatus> {
  return apiFetch<JobStatus>(`/library-health/jobs/${jobId}`)
}

export async function refreshMetadata(
  movieIds: string[],
  showIds: string[],
): Promise<{ jobId: string; total: number }> {
  return apiFetch('/library-health/metadata/refresh', {
    method: 'POST',
    body: JSON.stringify({ movieIds, showIds }),
  })
}

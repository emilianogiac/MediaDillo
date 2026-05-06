import { apiFetch } from './client.js'

export interface RenamePreviewItem {
  id: string
  type: 'movie-file' | 'episode-file'
  currentPath: string
  proposedPath: string
  needsRename: boolean
}

export interface StaleFile {
  id: string
  path: string
  reason: string | null
  resolved: boolean
  createdAt: string
  scanLog: { startedAt: string }
}

export interface StaleFilesResponse {
  items: StaleFile[]
  total: number
}

export interface RenameResult {
  renamed: number
  errors: string[]
}

export async function fetchRenamePreview(
  type: 'movies' | 'episodes' = 'movies',
  ids?: string[],
): Promise<RenamePreviewItem[]> {
  const params = new URLSearchParams({ type })
  if (ids && ids.length > 0) params.set('ids', ids.join(','))
  return apiFetch<RenamePreviewItem[]>(`/files/rename-preview?${params}`)
}

export async function applyRenames(
  type: 'movies' | 'episodes',
  fileIds: string[],
): Promise<RenameResult> {
  return apiFetch<RenameResult>('/files/rename', {
    method: 'POST',
    body: JSON.stringify({ type, fileIds }),
  })
}

export async function fetchStaleFiles(
  limit = 100,
  offset = 0,
): Promise<StaleFilesResponse> {
  return apiFetch<StaleFilesResponse>(`/files/stale?limit=${limit}&offset=${offset}`)
}

export async function deleteStaleFile(id: string): Promise<void> {
  await apiFetch(`/files/stale/${id}`, { method: 'DELETE' })
}

export async function resolveStaleFile(id: string): Promise<void> {
  await apiFetch(`/files/stale/${id}/resolve`, { method: 'PATCH' })
}

export async function bulkDeleteStaleFiles(ids: string[]): Promise<{ deleted: number; errors: string[] }> {
  return apiFetch('/files/stale/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

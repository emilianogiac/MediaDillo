import { apiFetch } from './client.js'

export interface RenamePreviewItem {
  id: string
  type: 'movie-file' | 'episode-file' | 'show-folder'
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
  showFolderItems?: RenamePreviewItem[],
): Promise<RenameResult> {
  return apiFetch<RenameResult>('/files/rename', {
    method: 'POST',
    body: JSON.stringify({ type, fileIds, ...(showFolderItems ? { showFolderItems } : {}) }),
  })
}

export async function renameBatch(
  movieIds: string[],
): Promise<{ jobId: string | null; total: number; message?: string }> {
  return apiFetch('/files/rename-batch', {
    method: 'POST',
    body: JSON.stringify({ movieIds }),
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

export interface MultiPartCandidate {
  movieId: string
  title: string
  year: number | null
  part1: { id: string; path: string; sizeBytes: string | null }
  part2: { id: string; path: string; sizeBytes: string | null }
}

export async function fetchMultiPartMovies(): Promise<MultiPartCandidate[]> {
  return apiFetch<MultiPartCandidate[]>('/files/multi-part')
}

export async function mergeMovieParts(movieId: string): Promise<{ outputPath: string } | { error: string }> {
  return apiFetch('/files/merge-parts', {
    method: 'POST',
    body: JSON.stringify({ movieId }),
  })
}

export interface EpisodeRemapRequest {
  fileId: string
  showId: string
  seasonNumber: number
  episodeStart: number
  episodeEnd?: number
}

export async function remapEpisode(req: EpisodeRemapRequest): Promise<unknown> {
  return apiFetch('/files/episode-remap', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export interface EpisodeFileRecord {
  id: string
  path: string
  multiEpisodeEnd: number | null
  episode: {
    episodeNumber: number
    title: string | null
    season: {
      seasonNumber: number
      show: { id: string; title: string }
    }
  }
}

export async function fetchEpisodeFiles(): Promise<EpisodeFileRecord[]> {
  return apiFetch<EpisodeFileRecord[]>('/files/episode-files')
}

export interface RenameLogEntry {
  id: string
  createdAt: string
  fromPath: string
  toPath: string
  trigger: 'manual' | 'match'
}

export async function fetchRenameLog(movieId: string): Promise<RenameLogEntry[]> {
  return apiFetch<RenameLogEntry[]>(`/files/rename-log?movieId=${movieId}`)
}

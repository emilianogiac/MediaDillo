import { apiFetch } from './client.js'
import type { MovieSummary, MovieDetail, ScanRoot, ImageCandidate } from './types.js'

export interface MoviesFilter {
  scanRootId?: string
  genre?: string
  qualityTier?: string
  missingArtwork?: boolean
  unmatched?: boolean
  missingFile?: boolean
  needsRename?: boolean
  organized?: boolean
  duplicates?: 'only' | 'hide'
  search?: string
  edition?: string
  tmdbId?: number
}

export async function fetchMovies(filter: MoviesFilter = {}): Promise<MovieSummary[]> {
  const params = new URLSearchParams()
  if (filter.scanRootId) params.set('scanRootId', filter.scanRootId)
  if (filter.genre) params.set('genre', filter.genre)
  if (filter.qualityTier) params.set('qualityTier', filter.qualityTier)
  if (filter.missingArtwork) params.set('missingArtwork', 'true')
  if (filter.unmatched) params.set('unmatched', 'true')
  if (filter.missingFile) params.set('missingFile', 'true')
  if (filter.needsRename) params.set('needsRename', 'true')
  if (filter.organized === false) params.set('organized', 'false')
  if (filter.duplicates) params.set('duplicates', filter.duplicates)
  if (filter.search) params.set('search', filter.search)
  if (filter.edition) params.set('edition', filter.edition)
  if (filter.tmdbId) params.set('tmdbId', String(filter.tmdbId))
  const qs = params.toString()
  return apiFetch<MovieSummary[]>(`/movies${qs ? `?${qs}` : ''}`)
}


export async function fetchMovie(id: string): Promise<MovieDetail> {
  return apiFetch<MovieDetail>(`/movies/${id}`)
}

export async function fetchScanRoots(): Promise<ScanRoot[]> {
  return apiFetch<ScanRoot[]>('/scan-roots')
}

export async function triggerMovieDownload(
  id: string,
  type: 'poster' | 'backdrop' | 'all',
): Promise<void> {
  await apiFetch(`/artwork/movies/${id}/download?type=${type}`, { method: 'POST' })
}

export async function fetchMovieImages(id: string): Promise<{ posters: ImageCandidate[]; backdrops: ImageCandidate[] }> {
  return apiFetch(`/artwork/movies/${id}/images`)
}

export async function selectMovieImage(
  id: string,
  filePath: string,
  artworkType: 'poster' | 'backdrop',
): Promise<void> {
  await apiFetch(`/artwork/movies/${id}/select`, {
    method: 'POST',
    body: JSON.stringify({ filePath, artworkType }),
  })
}

export async function cleanupTvContamination(): Promise<{ deleted: number }> {
  return apiFetch('/movies/cleanup-tv-contamination', { method: 'POST' })
}

export async function fetchMovieCandidates(id: string, query?: string): Promise<{ movie: { id: string; title: string; year: number | null }; candidates: import('./types.js').MovieCandidate[] }> {
  const qs = query ? `?q=${encodeURIComponent(query)}` : ''
  return apiFetch(`/metadata/movies/${id}/candidates${qs}`)
}

export async function matchMovie(id: string, tmdbId: number): Promise<void> {
  await apiFetch(`/metadata/movies/${id}/match`, {
    method: 'POST',
    body: JSON.stringify({ tmdbId }),
  })
}

export async function deleteMovie(id: string): Promise<void> {
  await apiFetch(`/movies/${id}`, { method: 'DELETE' })
}

export async function deleteMovieWithFiles(id: string): Promise<{ deleted: number; folderPath: string }> {
  return apiFetch(`/movies/${id}/with-files`, { method: 'DELETE' })
}

export async function rescanMovie(id: string): Promise<{ added: number; changed: number; removed: number }> {
  return apiFetch(`/movies/${id}/rescan`, { method: 'POST' })
}

export async function setMovieFileOrder(movieId: string, fileIds: string[]): Promise<void> {
  await apiFetch(`/movies/${movieId}/files/order`, {
    method: 'PATCH',
    body: JSON.stringify({ fileIds }),
  })
}

export async function moveMovie(movieId: string, targetScanRootId: string): Promise<{ moved: boolean; newFolder: string }> {
  return apiFetch(`/movies/${movieId}/move`, {
    method: 'POST',
    body: JSON.stringify({ targetScanRootId }),
  })
}

export type FolderFileCategory = 'video' | 'artwork' | 'subtitle' | 'nfo' | 'extra-art' | 'extra-nfo' | 'unknown'

export interface FolderFile {
  name: string
  path: string
  size: number
  category: FolderFileCategory
}

export async function fetchMovieFolderScan(movieId: string): Promise<{ folderPath: string; files: FolderFile[] }> {
  return apiFetch(`/movies/${movieId}/folder-scan`)
}

export async function cleanupMovieFolder(movieId: string, paths: string[]): Promise<{ deleted: number }> {
  return apiFetch(`/movies/${movieId}/cleanup`, {
    method: 'POST',
    body: JSON.stringify({ paths }),
  })
}

export async function deleteMovieFileSingle(fileId: string): Promise<{ deleted: number; path: string }> {
  return apiFetch(`/movies/files/${fileId}/from-disk`, { method: 'DELETE' })
}

export async function updateFileEdition(fileId: string, edition: string | null): Promise<void> {
  await apiFetch(`/movies/files/${fileId}/edition`, {
    method: 'PATCH',
    body: JSON.stringify({ edition }),
  })
}

export async function fetchEditions(): Promise<string[]> {
  const r = await apiFetch<{ editions: string[] }>('/movies/editions')
  return r.editions
}

export async function renameEdition(from: string, to: string | null): Promise<{ updated: number }> {
  return apiFetch('/movies/editions/rename', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  })
}

export async function updateMovieMetadata(
  id: string,
  data: { title?: string; year?: number | null; tagline?: string | null; overview?: string | null },
): Promise<void> {
  await apiFetch(`/metadata/movies/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

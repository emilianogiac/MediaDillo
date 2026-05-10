import { apiFetch } from './client.js'
import type { ShowSummary, ShowDetail, SeasonDetail, ImageCandidate, MovieCandidate } from './types.js'
import type { RenamePreviewItem } from './files.js'

export interface ShowsFilter {
  search?: string
  qualityTier?: string
  missingArtwork?: boolean
  unmatched?: boolean
  organized?: boolean
  duplicates?: 'only' | 'hide'
  addedSince?: string
  scanRootId?: string
  status?: 'continuing' | 'ended'
}

export async function fetchShows(filter: ShowsFilter = {}): Promise<ShowSummary[]> {
  const params = new URLSearchParams()
  if (filter.search) params.set('search', filter.search)
  if (filter.qualityTier) params.set('qualityTier', filter.qualityTier)
  if (filter.missingArtwork) params.set('missingArtwork', 'true')
  if (filter.unmatched) params.set('unmatched', 'true')
  if (filter.organized === false) params.set('organized', 'false')
  if (filter.duplicates) params.set('duplicates', filter.duplicates)
  if (filter.addedSince) params.set('addedSince', filter.addedSince)
  if (filter.scanRootId) params.set('scanRootId', filter.scanRootId)
  if (filter.status) params.set('status', filter.status)
  const qs = params.toString()
  return apiFetch<ShowSummary[]>(`/shows${qs ? `?${qs}` : ''}`)
}

export async function fetchShow(id: string): Promise<ShowDetail> {
  return apiFetch<ShowDetail>(`/shows/${id}`)
}

export async function fetchSeason(showId: string, seasonNumber: number): Promise<SeasonDetail> {
  return apiFetch<SeasonDetail>(`/shows/${showId}/seasons/${seasonNumber}`)
}

export async function triggerShowDownload(
  id: string,
  type: 'poster' | 'backdrop' | 'all',
): Promise<void> {
  await apiFetch(`/artwork/shows/${id}/download?type=${type}`, { method: 'POST' })
}

export async function fetchShowImages(id: string): Promise<{ posters: ImageCandidate[]; backdrops: ImageCandidate[] }> {
  return apiFetch(`/artwork/shows/${id}/images`)
}

export async function selectShowImage(
  id: string,
  filePath: string,
  artworkType: 'poster' | 'backdrop',
): Promise<void> {
  await apiFetch(`/artwork/shows/${id}/select`, {
    method: 'POST',
    body: JSON.stringify({ filePath, artworkType }),
  })
}

export async function fetchShowCandidates(id: string): Promise<{ show: { id: string; title: string; year: number | null }; candidates: MovieCandidate[] }> {
  return apiFetch(`/metadata/shows/${id}/candidates`)
}

export async function matchShow(id: string, tmdbId: number): Promise<void> {
  await apiFetch(`/metadata/shows/${id}/match`, {
    method: 'POST',
    body: JSON.stringify({ tmdbId }),
  })
}

export interface OrganizeRenameItem {
  id: string
  type: 'episode-file' | 'show-folder'
  currentPath: string
  proposedPath: string
  needsRename: boolean
}

export interface OrganizeRemoval {
  path: string
  reason: string
}

export interface OrganizePreview {
  renames: OrganizeRenameItem[]
  removals: OrganizeRemoval[]
  showFolder: string
}

export async function fetchOrganizePreview(showId: string): Promise<OrganizePreview> {
  return apiFetch<OrganizePreview>(`/shows/${showId}/organize`)
}

export async function applyOrganize(
  showId: string,
  renames: string[],
  trash: string[],
): Promise<{ renamed: number; trashed: number; errors: string[] }> {
  return apiFetch(`/shows/${showId}/organize/apply`, {
    method: 'POST',
    body: JSON.stringify({ renames, trash }),
  })
}

export async function renameAllShowEpisodes(showId: string): Promise<{ renamed: number; errors: string[] }> {
  const preview = await fetchOrganizePreview(showId)
  if (preview.renames.length === 0) return { renamed: 0, errors: [] }
  const result = await applyOrganize(showId, preview.renames.map((r) => r.id), [])
  return { renamed: result.renamed, errors: result.errors }
}

export async function fetchSeasonRenamePreview(showId: string, seasonNumber: number): Promise<RenamePreviewItem[]> {
  return apiFetch<RenamePreviewItem[]>(`/shows/${showId}/seasons/${seasonNumber}/rename-preview`)
}

export interface RescanResult {
  added: number
  changed: number
  removed: number
  filesFound: number
  filesSkipped: { path: string; reason: string }[]
  folderFound: boolean
}

export async function rescanSeason(showId: string, seasonNumber: number): Promise<RescanResult> {
  return apiFetch(`/shows/${showId}/seasons/${seasonNumber}/rescan`, { method: 'POST' })
}

export async function rescanShow(showId: string): Promise<RescanResult> {
  return apiFetch(`/shows/${showId}/rescan`, { method: 'POST' })
}

export async function mergeParts(
  showId: string,
  seasonNumber: number,
  primaryEpisode: number,
  secondaryEpisode: number,
): Promise<{ renamed: number; errors: string[] }> {
  return apiFetch(`/shows/${showId}/seasons/${seasonNumber}/merge-parts`, {
    method: 'POST',
    body: JSON.stringify({ primaryEpisode, secondaryEpisode }),
  })
}

export async function renumberEpisodes(
  showId: string,
  seasonNumber: number,
  fromEpisode: number,
  shift: number,
): Promise<{ renamed: number; errors: string[] }> {
  return apiFetch(`/shows/${showId}/seasons/${seasonNumber}/renumber`, {
    method: 'POST',
    body: JSON.stringify({ fromEpisode, shift }),
  })
}


export async function moveShow(showId: string, targetScanRootId: string): Promise<{ moved: boolean; newFolder: string }> {
  return apiFetch(`/shows/${showId}/move`, {
    method: 'POST',
    body: JSON.stringify({ targetScanRootId }),
  })
}

export async function deleteShow(id: string): Promise<void> {
  await apiFetch(`/shows/${id}`, { method: 'DELETE' })
}

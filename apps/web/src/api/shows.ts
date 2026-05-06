import { apiFetch } from './client.js'
import type { ShowSummary, ShowDetail, SeasonDetail, ImageCandidate, MovieCandidate } from './types.js'

export interface ShowsFilter {
  search?: string
  qualityTier?: string
  missingArtwork?: boolean
  unmatched?: boolean
  duplicates?: 'only' | 'hide'
}

export async function fetchShows(filter: ShowsFilter = {}): Promise<ShowSummary[]> {
  const params = new URLSearchParams()
  if (filter.search) params.set('search', filter.search)
  if (filter.qualityTier) params.set('qualityTier', filter.qualityTier)
  if (filter.missingArtwork) params.set('missingArtwork', 'true')
  if (filter.unmatched) params.set('unmatched', 'true')
  if (filter.duplicates) params.set('duplicates', filter.duplicates)
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

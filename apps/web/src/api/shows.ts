import { apiFetch } from './client.js'
import type { ShowSummary, ShowDetail, SeasonDetail, ImageCandidate } from './types.js'

export interface ShowsFilter {
  search?: string
  qualityTier?: string
  missingArtwork?: boolean
  unmatched?: boolean
}

export async function fetchShows(filter: ShowsFilter = {}): Promise<ShowSummary[]> {
  const params = new URLSearchParams()
  if (filter.search) params.set('search', filter.search)
  if (filter.qualityTier) params.set('qualityTier', filter.qualityTier)
  if (filter.missingArtwork) params.set('missingArtwork', 'true')
  if (filter.unmatched) params.set('unmatched', 'true')
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

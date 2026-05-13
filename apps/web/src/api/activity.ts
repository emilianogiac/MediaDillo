import { apiFetch } from './client.js'

export type ActivityAction =
  | 'rename'
  | 'cleanup'
  | 'scan_complete'
  | 'item_added'
  | 'item_removed'
  | 'collection_move'
  | 'episode_merge'
  | 'episode_assign'

export interface ActivityLogEntry {
  id: string
  createdAt: string
  expiresAt: string
  action: ActivityAction
  movieId: string | null
  showId: string | null
  episodeId: string | null
  fromPath: string | null
  toPath: string | null
  filePath: string | null
  detail: Record<string, unknown> | null
  revertedAt: string | null
  revertOfId: string | null
}

export interface ActivityLogResponse {
  items: ActivityLogEntry[]
  total: number
}

export interface ActivityFilter {
  action?: ActivityAction[]
  movieId?: string
  showId?: string
  limit?: number
  offset?: number
}

export async function fetchActivity(filter: ActivityFilter = {}): Promise<ActivityLogResponse> {
  const params = new URLSearchParams()
  if (filter.action?.length) params.set('action', filter.action.join(','))
  if (filter.movieId) params.set('movieId', filter.movieId)
  if (filter.showId) params.set('showId', filter.showId)
  if (filter.limit != null) params.set('limit', String(filter.limit))
  if (filter.offset != null) params.set('offset', String(filter.offset))
  const qs = params.toString()
  return apiFetch<ActivityLogResponse>(`/activity${qs ? `?${qs}` : ''}`)
}

export async function revertActivityEntries(
  ids: string[],
): Promise<{ ok: string[]; failed: { id: string; error: string }[] }> {
  return apiFetch('/activity/revert', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

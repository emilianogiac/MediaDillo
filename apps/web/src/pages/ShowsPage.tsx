import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { ShowSummary } from '../api/types.js'
import { fetchShows } from '../api/shows.js'

type Filter = {
  search: string
  qualityTier: string
  missingArtwork: boolean
  unmatched: boolean
}

const QUALITY_TIERS = ['360p', '480p', '576p', '720p', '1080p', '1440p', '4K']

function completenessColor(owned: number, total: number): string {
  if (total === 0) return 'bg-gray-700'
  const pct = owned / total
  if (pct === 1) return 'bg-green-600'
  if (pct >= 0.8) return 'bg-blue-600'
  if (pct >= 0.5) return 'bg-yellow-600'
  return 'bg-red-700'
}

function ShowCard({ show }: { show: ShowSummary }) {
  const unmatched = !show.tmdbId
  const missingArt = !show.posterDownloaded || !show.backdropDownloaded
  const pct = show.totalEpisodes > 0 ? Math.round((show.ownedEpisodes / show.totalEpisodes) * 100) : null

  return (
    <Link
      to={`/shows/${show.id}`}
      className="group relative flex flex-col rounded-lg overflow-hidden bg-surface-raised border border-gray-800 hover:border-accent/60 transition-colors"
    >
      {/* Poster */}
      <div className="aspect-[2/3] bg-gray-800 overflow-hidden">
        {show.posterUrl ? (
          <img
            src={show.posterUrl}
            alt={show.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs text-center px-2">
            No Poster
          </div>
        )}
      </div>

      {/* Health badges */}
      {(unmatched || missingArt) && (
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 items-end">
          {unmatched && (
            <span className="bg-red-600/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">
              Unmatched
            </span>
          )}
          {!unmatched && missingArt && (
            <span className="bg-yellow-500/90 text-yellow-900 text-xs px-1.5 py-0.5 rounded font-medium">
              Art missing
            </span>
          )}
        </div>
      )}

      {/* Status badge */}
      {show.status === 'continuing' && (
        <div className="absolute bottom-9 left-1.5">
          <span className="bg-green-700/80 text-green-100 text-xs px-1.5 py-0.5 rounded font-medium">
            Airing
          </span>
        </div>
      )}

      {/* Title + progress strip */}
      <div className="p-2 space-y-1.5">
        <p className="text-xs font-medium text-gray-100 truncate">{show.title}</p>
        <p className="text-xs text-gray-500">{show.year ?? '—'}</p>
        {show.totalEpisodes > 0 && (
          <div className="space-y-0.5">
            <div className="h-1 rounded-full bg-gray-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${completenessColor(show.ownedEpisodes, show.totalEpisodes)}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">
              {show.ownedEpisodes}/{show.totalEpisodes} ep
            </p>
          </div>
        )}
      </div>
    </Link>
  )
}

export function ShowsPage() {
  const [shows, setShows] = useState<ShowSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>({
    search: '',
    qualityTier: '',
    missingArtwork: false,
    unmatched: false,
  })

  useEffect(() => {
    setLoading(true)
    setError(null)
    const f = filter
    const showFilter: import('../api/shows.js').ShowsFilter = {}
    if (f.search) showFilter.search = f.search
    if (f.qualityTier) showFilter.qualityTier = f.qualityTier
    if (f.missingArtwork) showFilter.missingArtwork = true
    if (f.unmatched) showFilter.unmatched = true
    fetchShows(showFilter)
      .then(setShows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [filter])

  function setPartial(partial: Partial<Filter>) {
    setFilter((f) => ({ ...f, ...partial }))
  }

  const hasActiveFilter = filter.search || filter.qualityTier || filter.missingArtwork || filter.unmatched

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">TV Shows</h1>
        <span className="text-sm text-gray-500">{loading ? '…' : `${shows.length} shows`}</span>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="search"
          placeholder="Search shows…"
          value={filter.search}
          onChange={(e) => setPartial({ search: e.target.value })}
          className="bg-surface-raised border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent w-48"
        />

        <select
          value={filter.qualityTier}
          onChange={(e) => setPartial({ qualityTier: e.target.value })}
          className="bg-surface-raised border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent"
        >
          <option value="">All quality</option>
          {QUALITY_TIERS.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filter.missingArtwork}
            onChange={(e) => setPartial({ missingArtwork: e.target.checked })}
            className="accent-accent"
          />
          Missing artwork
        </label>

        <label className="flex items-center gap-1.5 text-sm text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filter.unmatched}
            onChange={(e) => setPartial({ unmatched: e.target.checked })}
            className="accent-accent"
          />
          Unmatched
        </label>

        {hasActiveFilter && (
          <button
            onClick={() => setPartial({ search: '', qualityTier: '', missingArtwork: false, unmatched: false })}
            className="text-xs text-gray-500 hover:text-gray-200 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading && <div className="flex items-center justify-center py-16 text-gray-500">Loading…</div>}
      {!loading && error && <div className="text-red-400 py-8 text-center text-sm">{error}</div>}
      {!loading && !error && shows.length === 0 && (
        <div className="text-gray-500 py-16 text-center text-sm">No shows found.</div>
      )}
      {!loading && !error && shows.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {shows.map((show) => (
            <ShowCard key={show.id} show={show} />
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { MovieSummary, ScanRoot } from '../api/types.js'
import { fetchMovies, fetchScanRoots } from '../api/movies.js'
import { PosterCard } from '../components/PosterCard.js'
import { useState } from 'react'

const QUALITY_TIERS = ['360p', '480p', '576p', '720p', '1080p', '1440p', '4K']

export function MoviesPage() {
  const [movies, setMovies] = useState<MovieSummary[]>([])
  const [scanRoots, setScanRoots] = useState<ScanRoot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  // Derive filter from URL — survives back-navigation
  const filter = {
    scanRootId: searchParams.get('root') ?? '',
    search: searchParams.get('q') ?? '',
    genre: searchParams.get('genre') ?? '',
    qualityTier: searchParams.get('quality') ?? '',
    missingArtwork: searchParams.has('missing'),
    unmatched: searchParams.has('unmatched'),
  }

  function setPartial(partial: {
    scanRootId?: string
    search?: string
    genre?: string
    qualityTier?: string
    missingArtwork?: boolean
    unmatched?: boolean
  }) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if ('scanRootId' in partial) {
          partial.scanRootId ? next.set('root', partial.scanRootId) : next.delete('root')
        }
        if ('search' in partial) {
          partial.search ? next.set('q', partial.search) : next.delete('q')
        }
        if ('genre' in partial) {
          partial.genre ? next.set('genre', partial.genre) : next.delete('genre')
        }
        if ('qualityTier' in partial) {
          partial.qualityTier ? next.set('quality', partial.qualityTier) : next.delete('quality')
        }
        if ('missingArtwork' in partial) {
          partial.missingArtwork ? next.set('missing', '1') : next.delete('missing')
        }
        if ('unmatched' in partial) {
          partial.unmatched ? next.set('unmatched', '1') : next.delete('unmatched')
        }
        return next
      },
      { replace: true },
    )
  }

  useEffect(() => {
    fetchScanRoots()
      .then((roots) => setScanRoots(roots.filter((r) => r.type === 'movies')))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const movieFilter: import('../api/movies.js').MoviesFilter = {}
    if (filter.scanRootId) movieFilter.scanRootId = filter.scanRootId
    if (filter.search) movieFilter.search = filter.search
    if (filter.genre) movieFilter.genre = filter.genre
    if (filter.qualityTier) movieFilter.qualityTier = filter.qualityTier
    if (filter.missingArtwork) movieFilter.missingArtwork = true
    if (filter.unmatched) movieFilter.unmatched = true
    fetchMovies(movieFilter)
      .then(setMovies)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [searchParams.toString()]) // re-run whenever URL params change; toString() is stable by value

  const allGenres = useMemo(
    () => [...new Set(movies.flatMap((m) => m.genres))].sort(),
    [movies],
  )

  const hasActiveFilter =
    filter.search || filter.genre || filter.qualityTier || filter.missingArtwork || filter.unmatched

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Movies</h1>
        <span className="text-sm text-gray-500">{loading ? '…' : `${movies.length} titles`}</span>
      </div>

      {/* Category tabs */}
      {scanRoots.length > 0 && (
        <div className="flex gap-1 border-b border-gray-800">
          <button
            onClick={() => setPartial({ scanRootId: '' })}
            className={[
              'px-3 py-1.5 text-sm font-medium rounded-t -mb-px border transition-colors',
              !filter.scanRootId
                ? 'bg-surface-raised text-white border-gray-700 border-b-surface-raised'
                : 'text-gray-400 hover:text-gray-200 border-transparent',
            ].join(' ')}
          >
            All
          </button>
          {scanRoots.map((root) => (
            <button
              key={root.id}
              onClick={() => setPartial({ scanRootId: root.id })}
              className={[
                'px-3 py-1.5 text-sm font-medium rounded-t -mb-px border transition-colors',
                filter.scanRootId === root.id
                  ? 'bg-surface-raised text-white border-gray-700 border-b-surface-raised'
                  : 'text-gray-400 hover:text-gray-200 border-transparent',
              ].join(' ')}
            >
              {root.label}
            </button>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="search"
          placeholder="Search titles…"
          value={filter.search}
          onChange={(e) => setPartial({ search: e.target.value })}
          className="bg-surface-raised border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent w-48"
        />

        <select
          value={filter.genre}
          onChange={(e) => setPartial({ genre: e.target.value })}
          className="bg-surface-raised border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent"
        >
          <option value="">All genres</option>
          {allGenres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>

        <select
          value={filter.qualityTier}
          onChange={(e) => setPartial({ qualityTier: e.target.value })}
          className="bg-surface-raised border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent"
        >
          <option value="">All quality</option>
          {QUALITY_TIERS.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
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
            onClick={() =>
              setPartial({
                search: '',
                genre: '',
                qualityTier: '',
                missingArtwork: false,
                unmatched: false,
              })
            }
            className="text-xs text-gray-500 hover:text-gray-200 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Grid */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-500">Loading…</div>
      )}
      {!loading && error && (
        <div className="text-red-400 py-8 text-center text-sm">{error}</div>
      )}
      {!loading && !error && movies.length === 0 && (
        <div className="text-gray-500 py-16 text-center text-sm">No movies found.</div>
      )}
      {!loading && !error && movies.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {movies.map((movie) => (
            <PosterCard key={movie.id} movie={movie} />
          ))}
        </div>
      )}
    </div>
  )
}

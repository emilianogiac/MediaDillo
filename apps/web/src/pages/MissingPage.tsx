import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import type { MissingShow, WantedMovie } from '../api/missing.js'
import type { MovieCandidate } from '../api/types.js'
import {
  fetchMissingShows,
  fetchWantedMovies,
  addWantedMovie,
  removeWantedMovie,
  searchMoviesForWishlist,
} from '../api/missing.js'

// ---------------------------------------------------------------------------
// TV Shows tab
// ---------------------------------------------------------------------------

function ShowsTab() {
  const [shows, setShows] = useState<MissingShow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<'missing' | 'title' | 'percent'>('missing')

  useEffect(() => {
    setLoading(true)
    fetchMissingShows()
      .then(setShows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const sorted = [...shows].sort((a, b) => {
    if (sort === 'missing') return b.missingCount - a.missingCount
    if (sort === 'title') return a.title.localeCompare(b.title)
    // percent complete ascending (most incomplete first)
    const pctA = a.totalEpisodes > 0 ? a.ownedEpisodes / a.totalEpisodes : 0
    const pctB = b.totalEpisodes > 0 ? b.ownedEpisodes / b.totalEpisodes : 0
    return pctA - pctB
  })

  if (loading) return <div className="py-12 text-center text-gray-500">Loading…</div>
  if (error) return <div className="py-8 text-center text-red-400 text-sm">{error}</div>
  if (shows.length === 0) {
    return (
      <div className="py-16 text-center text-gray-500 text-sm">
        No missing episodes found.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Sort controls */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">Sort by:</span>
        {(['missing', 'title', 'percent'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSort(s)}
            className={[
              'px-2 py-1 rounded transition-colors',
              sort === s
                ? 'bg-accent/20 text-accent'
                : 'text-gray-400 hover:text-gray-200',
            ].join(' ')}
          >
            {s === 'missing' ? 'Missing count' : s === 'title' ? 'Title' : '% complete'}
          </button>
        ))}
        <span className="ml-auto text-gray-500">{shows.length} shows</span>
      </div>

      {/* Show list */}
      <div className="space-y-2">
        {sorted.map((show) => {
          const pct = show.totalEpisodes > 0
            ? Math.round((show.ownedEpisodes / show.totalEpisodes) * 100)
            : 0
          const barColor =
            pct >= 80 ? 'bg-blue-600' : pct >= 50 ? 'bg-yellow-600' : 'bg-red-700'

          return (
            <Link
              key={show.id}
              to={`/shows/${show.id}`}
              className="flex items-center gap-4 bg-surface-raised border border-gray-700 hover:border-accent/60 rounded-lg px-4 py-3 transition-colors"
            >
              {/* Mini poster */}
              <div className="flex-shrink-0 w-10 h-14 rounded overflow-hidden bg-gray-800">
                {show.posterUrl ? (
                  <img src={show.posterUrl} alt={show.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gray-700" />
                )}
              </div>

              {/* Title + progress */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-gray-100 truncate">{show.title}</span>
                  {show.year && <span className="text-xs text-gray-500 flex-shrink-0">{show.year}</span>}
                  {show.showStatus === 'continuing' && (
                    <span className="text-xs bg-green-700/60 text-green-300 px-1.5 py-0.5 rounded-full flex-shrink-0">
                      Airing
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 rounded-full bg-gray-700 overflow-hidden w-32">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500">
                    {show.ownedEpisodes}/{show.totalEpisodes} ({pct}%)
                  </span>
                </div>
              </div>

              {/* Missing badge */}
              <div className="flex-shrink-0">
                <span className="bg-red-800/60 text-red-300 text-xs font-medium px-2 py-1 rounded">
                  {show.missingCount} missing
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Movie Wishlist tab
// ---------------------------------------------------------------------------

function WishlistTab() {
  const [movies, setMovies] = useState<WantedMovie[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showSearch, setShowSearch] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetchWantedMovies()
      .then(setMovies)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function remove(id: string) {
    await removeWantedMovie(id)
    setMovies((m) => m.filter((x) => x.id !== id))
  }

  if (loading) return <div className="py-12 text-center text-gray-500">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{movies.length} movies in wishlist</span>
        <button
          onClick={() => setShowSearch((v) => !v)}
          className="text-sm px-3 py-1.5 rounded bg-accent hover:bg-accent-hover text-white transition-colors"
        >
          {showSearch ? 'Cancel' : '+ Add movie'}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {showSearch && (
        <SearchPanel
          onAdded={() => { setShowSearch(false); load() }}
        />
      )}

      {movies.length === 0 && !showSearch && (
        <div className="py-12 text-center text-gray-500 text-sm">
          Wishlist is empty. Add movies you want to track.
        </div>
      )}

      {movies.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {movies.map((movie) => (
            <div
              key={movie.id}
              className="group relative flex flex-col rounded-lg overflow-hidden bg-surface-raised border border-gray-700"
            >
              <div className="aspect-[2/3] bg-gray-800 overflow-hidden">
                {movie.posterUrl ? (
                  <img src={movie.posterUrl} alt={movie.title} loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs text-center px-2">
                    No Poster
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="text-xs font-medium text-gray-100 truncate">{movie.title}</p>
                <p className="text-xs text-gray-500">{movie.year ?? '—'}</p>
              </div>
              {/* Remove button */}
              <button
                onClick={() => remove(movie.id)}
                className="absolute top-1.5 right-1.5 bg-black/60 text-gray-300 hover:text-red-400 text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove from wishlist"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Search panel for adding movies to wishlist
// ---------------------------------------------------------------------------

function SearchPanel({ onAdded }: { onAdded: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MovieCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  async function search() {
    if (!query.trim()) return
    setSearching(true)
    setSearchError(null)
    setResults([])
    try {
      const candidates = await searchMoviesForWishlist(query.trim())
      setResults(candidates)
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function addCandidate(c: MovieCandidate) {
    setAdding(true)
    type WishlistData = Parameters<typeof addWantedMovie>[0]
    const data: WishlistData = { title: c.title, tmdbId: c.tmdbId }
    if (c.year !== null) data.year = c.year
    if (c.overview) data.overview = c.overview
    if (c.posterUrl) data.posterUrl = c.posterUrl
    try {
      await addWantedMovie(data)
      onAdded()
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Failed to add movie')
      setAdding(false)
    }
  }

  return (
    <div className="bg-surface-raised border border-gray-700 rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-medium">Search for a movie to add</h3>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Movie title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          className="flex-1 bg-surface border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent"
        />
        <button
          onClick={search}
          disabled={searching || !query.trim()}
          className="px-3 py-1.5 text-sm rounded bg-surface-overlay hover:bg-gray-600 disabled:opacity-40 transition-colors"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {searchError && (
        <p className="text-xs text-red-400">{searchError}</p>
      )}

      {results.length > 0 && (
        <ul className="space-y-2 max-h-64 overflow-y-auto">
          {results.map((c) => (
            <li
              key={c.tmdbId}
              className="flex items-center gap-3 p-2 rounded hover:bg-surface-overlay transition-colors"
            >
              {c.posterUrl ? (
                <img src={c.posterUrl} alt={c.title} className="w-8 h-12 object-cover rounded flex-shrink-0" />
              ) : (
                <div className="w-8 h-12 bg-gray-700 rounded flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-100 truncate">{c.title}</p>
                <p className="text-xs text-gray-500">{c.year ?? '—'}</p>
              </div>
              <button
                onClick={() => addCandidate(c)}
                disabled={adding}
                className="flex-shrink-0 text-xs px-2 py-1 rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-40 transition-colors"
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'shows' | 'wishlist'

export function MissingPage() {
  const [tab, setTab] = useState<Tab>('shows')

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Missing Content</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {(['shows', 'wishlist'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-2 text-sm font-medium -mb-px border transition-colors rounded-t',
              tab === t
                ? 'bg-surface-raised text-white border-gray-700 border-b-surface-raised'
                : 'text-gray-400 hover:text-gray-200 border-transparent',
            ].join(' ')}
          >
            {t === 'shows' ? 'TV Shows' : 'Movie Wishlist'}
          </button>
        ))}
      </div>

      {tab === 'shows' ? <ShowsTab /> : <WishlistTab />}
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import type { MovieCandidate } from '../api/types.js'
import type { TvdbCandidate } from '../api/shows.js'

interface Props {
  mediaType: 'movie' | 'show'
  id: string
  currentTitle: string
  currentTmdbId: number | null
  fetchCandidates: (id: string, query?: string) => Promise<{ candidates: MovieCandidate[] }>
  onMatch: (id: string, tmdbId: number) => Promise<void>
  onClose: () => void
  onMatched: () => void
  fetchTvdbCandidates?: (id: string, query?: string) => Promise<{ candidates: TvdbCandidate[] }>
  onMatchTvdb?: (id: string, tvdbId: number) => Promise<void>
}

export function MatchModal({
  mediaType, id, currentTitle, currentTmdbId,
  fetchCandidates, onMatch, onClose, onMatched,
  fetchTvdbCandidates, onMatchTvdb,
}: Props) {
  const [activeTab, setActiveTab] = useState<'tmdb' | 'tvdb'>('tmdb')

  // TMDB state
  const [candidates, setCandidates] = useState<MovieCandidate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [matching, setMatching] = useState<number | null>(null)
  const [manualId, setManualId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)

  // TVDB state
  const [tvdbCandidates, setTvdbCandidates] = useState<TvdbCandidate[] | null>(null)
  const [tvdbLoading, setTvdbLoading] = useState(false)
  const [tvdbLoaded, setTvdbLoaded] = useState(false)
  const [tvdbError, setTvdbError] = useState<string | null>(null)
  const [tvdbMatching, setTvdbMatching] = useState<number | null>(null)
  const [tvdbManualId, setTvdbManualId] = useState('')
  const [tvdbSearchQuery, setTvdbSearchQuery] = useState('')
  const [tvdbSearching, setTvdbSearching] = useState(false)

  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchCandidates(id)
      .then((r) => setCandidates(r.candidates))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load candidates'))
      .finally(() => setLoading(false))
  }, [id, fetchCandidates])

  async function handleSearch() {
    if (!searchQuery.trim()) return
    setSearching(true)
    setError(null)
    try {
      const r = await fetchCandidates(id, searchQuery.trim())
      setCandidates(r.candidates)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function loadTvdbCandidates(query?: string) {
    if (!fetchTvdbCandidates) return
    setTvdbLoading(true)
    setTvdbError(null)
    try {
      const r = await fetchTvdbCandidates(id, query)
      setTvdbCandidates(r.candidates)
      setTvdbLoaded(true)
    } catch (e: unknown) {
      setTvdbError(e instanceof Error ? e.message : 'TVDB search failed')
    } finally {
      setTvdbLoading(false)
    }
  }

  async function handleTvdbSearch() {
    if (!tvdbSearchQuery.trim()) return
    setTvdbSearching(true)
    await loadTvdbCandidates(tvdbSearchQuery.trim())
    setTvdbSearching(false)
  }

  function handleTabSwitch(tab: 'tmdb' | 'tvdb') {
    setActiveTab(tab)
    if (tab === 'tvdb' && !tvdbLoaded && !tvdbLoading) {
      void loadTvdbCandidates()
    }
  }

  async function applyMatch(tmdbId: number) {
    setMatching(tmdbId)
    setError(null)
    try {
      await onMatch(id, tmdbId)
      onMatched()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Match failed')
      setMatching(null)
    }
  }

  async function applyTvdbMatch(tvdbId: number) {
    if (!onMatchTvdb) return
    setTvdbMatching(tvdbId)
    setTvdbError(null)
    try {
      await onMatchTvdb(id, tvdbId)
      onMatched()
    } catch (e: unknown) {
      setTvdbError(e instanceof Error ? e.message : 'Match failed')
      setTvdbMatching(null)
    }
  }

  async function submitManual() {
    const n = parseInt(manualId.trim(), 10)
    if (!n || isNaN(n)) {
      setError('Enter a valid numeric TMDB ID')
      return
    }
    await applyMatch(n)
  }

  async function submitTvdbManual() {
    const n = parseInt(tvdbManualId.trim(), 10)
    if (!n || isNaN(n)) {
      setTvdbError('Enter a valid numeric TVDB ID')
      return
    }
    await applyTvdbMatch(n)
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose()
  }

  const label = mediaType === 'movie' ? 'movie' : 'show'
  const showTvdbTab = mediaType === 'show' && !!fetchTvdbCandidates

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
    >
      <div className="bg-surface-raised border border-gray-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-100">Match {label}</h2>
            <p className="text-sm text-gray-400 mt-0.5 truncate max-w-md">{currentTitle}</p>
            {currentTmdbId && (
              <p className="text-xs text-gray-600 mt-0.5">Currently matched: TMDB #{currentTmdbId}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Tabs (shows only) */}
        {showTvdbTab && (
          <div className="flex border-b border-gray-800 px-5">
            <button
              onClick={() => handleTabSwitch('tmdb')}
              className={`text-sm px-3 py-2.5 border-b-2 transition-colors ${
                activeTab === 'tmdb'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              TMDB
            </button>
            <button
              onClick={() => handleTabSwitch('tvdb')}
              className={`text-sm px-3 py-2.5 border-b-2 transition-colors ${
                activeTab === 'tvdb'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              TVDB
              <span className="ml-1.5 text-xs text-gray-600">not on TMDB?</span>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── TMDB tab ── */}
          {activeTab === 'tmdb' && (
            <>
              {error && (
                <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">{error}</p>
              )}

              {/* Search input (movies only — shows auto-search on open) */}
              {mediaType === 'movie' && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
                    placeholder="Search TMDB by title…"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => { void handleSearch() }}
                    disabled={searching || !searchQuery.trim()}
                    className="px-4 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium disabled:opacity-40 transition-colors"
                  >
                    {searching ? 'Searching…' : 'Search'}
                  </button>
                </div>
              )}

              {/* Search input for shows (TMDB tab) */}
              {mediaType === 'show' && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
                    placeholder="Search TMDB by title…"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => { void handleSearch() }}
                    disabled={searching || !searchQuery.trim()}
                    className="px-4 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium disabled:opacity-40 transition-colors"
                  >
                    {searching ? 'Searching…' : 'Search'}
                  </button>
                </div>
              )}

              {loading ? (
                <p className="text-sm text-gray-500">Searching TMDB…</p>
              ) : candidates && candidates.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">TMDB results</p>
                  {candidates.map((c) => (
                    <button
                      key={c.tmdbId}
                      onClick={() => { void applyMatch(c.tmdbId) }}
                      disabled={matching !== null}
                      className="w-full flex gap-3 items-start p-3 rounded-lg border border-gray-700 hover:border-accent/60 hover:bg-white/5 transition-colors text-left disabled:opacity-50"
                    >
                      <div className="flex-shrink-0 w-10 rounded overflow-hidden bg-gray-800">
                        {c.posterUrl ? (
                          <img src={c.posterUrl} alt="" className="w-full object-cover aspect-[2/3]" />
                        ) : (
                          <div className="aspect-[2/3] bg-gray-700" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-gray-100 truncate">{c.title}</span>
                          {c.year && <span className="text-sm text-gray-400 flex-shrink-0">{c.year}</span>}
                        </div>
                        {c.overview && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{c.overview}</p>
                        )}
                        <p className="text-xs text-gray-600 mt-1">TMDB #{c.tmdbId}</p>
                      </div>
                      <span className={`flex-shrink-0 text-xs px-2 py-1 rounded font-medium mt-0.5 ${
                        matching === c.tmdbId
                          ? 'bg-accent/30 text-accent'
                          : 'bg-gray-700 text-gray-300'
                      }`}>
                        {matching === c.tmdbId ? 'Matching…' : 'Select'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                !loading && <p className="text-sm text-gray-500">No results found for "{currentTitle}".</p>
              )}

              <div className="pt-2 border-t border-gray-800">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Enter TMDB ID manually</p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={manualId}
                    onChange={(e) => setManualId(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void submitManual() }}
                    placeholder="e.g. 238"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => { void submitManual() }}
                    disabled={matching !== null || !manualId.trim()}
                    className="px-4 py-1.5 rounded bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-40 transition-colors"
                  >
                    {matching !== null && !candidates?.find(c => c.tmdbId === matching) ? 'Matching…' : 'Match'}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── TVDB tab ── */}
          {activeTab === 'tvdb' && (
            <>
              {tvdbError && (
                <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">{tvdbError}</p>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={tvdbSearchQuery}
                  onChange={(e) => setTvdbSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleTvdbSearch() }}
                  placeholder="Search TVDB by title…"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => { void handleTvdbSearch() }}
                  disabled={tvdbSearching || tvdbLoading || !tvdbSearchQuery.trim()}
                  className="px-4 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium disabled:opacity-40 transition-colors"
                >
                  {tvdbSearching ? 'Searching…' : 'Search'}
                </button>
              </div>

              {tvdbLoading ? (
                <p className="text-sm text-gray-500">Searching TVDB…</p>
              ) : tvdbCandidates && tvdbCandidates.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">TVDB results</p>
                  {tvdbCandidates.map((c) => (
                    <button
                      key={c.tvdbId}
                      onClick={() => { void applyTvdbMatch(c.tvdbId) }}
                      disabled={tvdbMatching !== null}
                      className="w-full flex gap-3 items-start p-3 rounded-lg border border-gray-700 hover:border-accent/60 hover:bg-white/5 transition-colors text-left disabled:opacity-50"
                    >
                      <div className="flex-shrink-0 w-10 rounded overflow-hidden bg-gray-800">
                        {c.imageUrl ? (
                          <img src={c.imageUrl} alt="" className="w-full object-cover aspect-[2/3]" />
                        ) : (
                          <div className="aspect-[2/3] bg-gray-700" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-gray-100 truncate">{c.name}</span>
                          {c.year && <span className="text-sm text-gray-400 flex-shrink-0">{c.year}</span>}
                        </div>
                        {c.network && <p className="text-xs text-gray-500 mt-0.5">{c.network}</p>}
                        {c.overview && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{c.overview}</p>
                        )}
                        <p className="text-xs text-gray-600 mt-1">TVDB #{c.tvdbId}</p>
                      </div>
                      <span className={`flex-shrink-0 text-xs px-2 py-1 rounded font-medium mt-0.5 ${
                        tvdbMatching === c.tvdbId
                          ? 'bg-accent/30 text-accent'
                          : 'bg-gray-700 text-gray-300'
                      }`}>
                        {tvdbMatching === c.tvdbId ? 'Matching…' : 'Select'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                tvdbLoaded && !tvdbLoading && (
                  <p className="text-sm text-gray-500">No results found. Try searching by title above.</p>
                )
              )}

              <div className="pt-2 border-t border-gray-800">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Enter TVDB ID manually</p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={tvdbManualId}
                    onChange={(e) => setTvdbManualId(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void submitTvdbManual() }}
                    placeholder="e.g. 79169"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => { void submitTvdbManual() }}
                    disabled={tvdbMatching !== null || !tvdbManualId.trim()}
                    className="px-4 py-1.5 rounded bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-40 transition-colors"
                  >
                    {tvdbMatching !== null && !tvdbCandidates?.find(c => c.tvdbId === tvdbMatching) ? 'Matching…' : 'Match'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

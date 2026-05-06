import { useState, useEffect, useRef } from 'react'
import type { MovieCandidate } from '../api/types.js'

interface Props {
  mediaType: 'movie' | 'show'
  id: string
  currentTitle: string
  currentTmdbId: number | null
  fetchCandidates: (id: string) => Promise<{ candidates: MovieCandidate[] }>
  onMatch: (id: string, tmdbId: number) => Promise<void>
  onClose: () => void
  onMatched: () => void
}

export function MatchModal({ mediaType, id, currentTitle, currentTmdbId, fetchCandidates, onMatch, onClose, onMatched }: Props) {
  const [candidates, setCandidates] = useState<MovieCandidate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [matching, setMatching] = useState<number | null>(null)
  const [manualId, setManualId] = useState('')
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchCandidates(id)
      .then((r) => setCandidates(r.candidates))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load candidates'))
      .finally(() => setLoading(false))
  }, [id, fetchCandidates])

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

  async function submitManual() {
    const n = parseInt(manualId.trim(), 10)
    if (!n || isNaN(n)) {
      setError('Enter a valid numeric TMDB ID')
      return
    }
    await applyMatch(n)
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose()
  }

  const label = mediaType === 'movie' ? 'movie' : 'show'

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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">{error}</p>
          )}

          {/* Candidate list */}
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
                  {/* Thumbnail */}
                  <div className="flex-shrink-0 w-10 rounded overflow-hidden bg-gray-800">
                    {c.posterUrl ? (
                      <img src={c.posterUrl} alt="" className="w-full object-cover aspect-[2/3]" />
                    ) : (
                      <div className="aspect-[2/3] bg-gray-700" />
                    )}
                  </div>

                  {/* Info */}
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

                  {/* Action */}
                  <span className={`flex-shrink-0 text-xs px-2 py-1 rounded font-medium mt-0.5 ${
                    matching === c.tmdbId
                      ? 'bg-accent/30 text-accent'
                      : 'bg-gray-700 text-gray-300 group-hover:bg-accent/20'
                  }`}>
                    {matching === c.tmdbId ? 'Matching…' : 'Select'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            !loading && <p className="text-sm text-gray-500">No candidates found for "{currentTitle}".</p>
          )}

          {/* Manual TMDB ID entry */}
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
        </div>
      </div>
    </div>
  )
}

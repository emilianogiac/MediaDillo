import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import type { ShowDetail } from '../api/types.js'
import type { ScanRoot } from '../api/types.js'
import { fetchShow, triggerShowDownload, fetchShowImages, selectShowImage, fetchShowCandidates, matchShow, moveShow, deleteShow } from '../api/shows.js'
import { fetchScanRoots } from '../api/movies.js'
import { ArtworkManager } from '../components/ArtworkManager.js'
import { MatchModal } from '../components/MatchModal.js'
import { OrganizePanel } from '../components/OrganizePanel.js'
import { useToast } from '../context/ToastContext.js'

function completenessBar(owned: number, total: number) {
  if (total === 0) return null
  const pct = Math.round((owned / total) * 100)
  const color =
    pct === 100 ? 'bg-green-600' : pct >= 80 ? 'bg-blue-600' : pct >= 50 ? 'bg-yellow-600' : 'bg-red-700'
  return (
    <div className="space-y-0.5">
      <div className="h-1.5 rounded-full bg-gray-700 overflow-hidden w-32">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-500">
        {owned}/{total} owned ({pct}%)
      </p>
    </div>
  )
}

export function ShowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const backToShows = `/shows${(location.state as { from?: string } | null)?.from ?? ''}`
  const { toast } = useToast()
  const [show, setShow] = useState<ShowDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMatchModal, setShowMatchModal] = useState(false)
  const [rematching, setRematching] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [scanRoots, setScanRoots] = useState<ScanRoot[]>([])
  const [moving, setMoving] = useState(false)
  const [moveTarget, setMoveTarget] = useState('')
  const [artworkVersion, setArtworkVersion] = useState(() => Date.now())

  const load = useCallback(() => {
    if (!id) return
    setLoading(true)
    fetchShow(id)
      .then(setShow)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => { fetchScanRoots().then(setScanRoots).catch(() => {}) }, [])

  async function handleRematch() {
    if (!id || !show?.tmdbId) return
    setRematching(true)
    try {
      await matchShow(id, show.tmdbId)
      load()
      toast({ type: 'success', message: 'Metadata refreshed from TMDB' })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Rematch failed' })
    } finally {
      setRematching(false)
    }
  }

  async function handleMove() {
    if (!id || !moveTarget) return
    setMoving(true)
    try {
      await moveShow(id, moveTarget)
      load()
      setMoveTarget('')
    } catch {
      // error visible via load failure
    } finally {
      setMoving(false)
    }
  }

  async function handleDelete() {
    if (!id || !window.confirm('Delete this record? This cannot be undone.')) return
    setDeleting(true)
    try {
      await deleteShow(id)
      navigate(backToShows, { replace: true })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Delete failed' })
      setDeleting(false)
    }
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>
  if (error || !show) {
    return (
      <div className="p-6 text-red-400">
        {error ?? 'Show not found'}
        <Link to={backToShows} className="block mt-2 text-sm text-accent hover:underline">
          ← Back to Shows
        </Link>
      </div>
    )
  }

  const directors = show.credits.filter((c) => c.role === 'director').slice(0, 5)
  const cast = show.credits.filter((c) => c.role === 'cast').slice(0, 12)

  return (
    <div className="p-6 space-y-8 max-w-5xl">
      <button onClick={() => navigate(backToShows)} className="text-sm text-gray-400 hover:text-accent transition-colors">
        ← TV Shows
      </button>

      {/* Hero */}
      <div className="flex gap-6">
        <div className="flex-shrink-0 self-start w-36 rounded-lg overflow-hidden bg-gray-800 border border-gray-700">
          {(show.posterDownloaded || show.posterUrl) ? (
            <img
              src={show.posterDownloaded ? `/api/artwork/shows/${show.id}/poster?v=${artworkVersion}` : show.posterUrl!}
              alt={show.title}
              className="w-full object-cover"
            />
          ) : (
            <div className="aspect-[2/3] flex items-center justify-center text-gray-600 text-xs text-center px-2">
              No Poster
            </div>
          )}
        </div>

        <div className="flex-1 space-y-3">
          <h1 className="text-3xl font-bold">{show.title}</h1>

          <div className="flex flex-wrap gap-3 text-sm text-gray-400">
            {show.year && <span>{show.year}</span>}
            {show.rating !== null && (
              <span className="text-yellow-400">★ {show.rating.toFixed(1)}</span>
            )}
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                show.status === 'continuing'
                  ? 'bg-green-700/60 text-green-300'
                  : 'bg-gray-600/60 text-gray-300'
              }`}
            >
              {show.status === 'continuing' ? 'Airing' : 'Ended'}
            </span>
            {(() => {
              const targets = scanRoots.filter((r) => r.type === 'tv')
              if (targets.length === 0) return null
              return (
                <span className="flex items-center gap-1">
                  <select
                    value={moveTarget}
                    onChange={(e) => setMoveTarget(e.target.value)}
                    className="text-xs bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-gray-300"
                  >
                    <option value="">Move to…</option>
                    {targets.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                  {moveTarget && (
                    <button
                      onClick={handleMove}
                      disabled={moving}
                      className="text-xs px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-40"
                    >
                      {moving ? '…' : 'Move'}
                    </button>
                  )}
                </span>
              )
            })()}
          </div>

          {show.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {show.genres.map((g) => (
                <span key={g} className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                  {g}
                </span>
              ))}
            </div>
          )}

          {show.overview && (
            <p className="text-sm text-gray-300 leading-relaxed max-w-2xl">{show.overview}</p>
          )}

          {completenessBar(show.ownedEpisodes, show.totalEpisodes)}

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-2 text-xs">
              {show.tmdbId && (
                <a
                  href={`https://www.themoviedb.org/tv/${show.tmdbId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-0.5 rounded bg-gray-700/60 text-accent hover:underline"
                >
                  TMDB ↗
                </a>
              )}
              {show.tvdbId && (
                <a
                  href={`https://www.thetvdb.com/?tab=series&id=${show.tvdbId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-0.5 rounded bg-gray-700/60 text-accent hover:underline"
                >
                  TVDB ↗
                </a>
              )}
              {show.imdbId && (
                <a
                  href={`https://www.imdb.com/title/${show.imdbId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-0.5 rounded bg-gray-700/60 text-accent hover:underline"
                >
                  IMDb ↗
                </a>
              )}
            </div>
            {show.tmdbId ? (
              <>
                <button
                  onClick={() => { void handleRematch() }}
                  disabled={rematching}
                  className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors disabled:opacity-40"
                  title="Refresh metadata from TMDB using current match"
                >
                  {rematching ? 'Refreshing…' : 'Re-match'}
                </button>
                <button
                  onClick={() => setShowMatchModal(true)}
                  className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors"
                  title="Assign a different TMDB entry"
                >
                  Match
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowMatchModal(true)}
                className="text-xs px-2.5 py-1 rounded border border-yellow-700/60 hover:border-accent/60 text-yellow-400 hover:text-accent transition-colors"
              >
                ⚠ Match to TMDB
              </button>
            )}
            <button
              onClick={() => { void handleDelete() }}
              disabled={deleting}
              className="text-xs px-2.5 py-1 rounded border border-red-700/40 text-red-500 hover:bg-red-700/20 transition-colors disabled:opacity-40"
              title="Remove this record from the database (files on disk are not affected)"
            >
              {deleting ? 'Removing…' : 'Remove record'}
            </button>
          </div>
        </div>
      </div>

      {/* Seasons grid */}
      {show.seasons.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Seasons</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {show.seasons.map((season) => {
              const pct =
                season.episodeCount > 0
                  ? Math.round((season.ownedCount / season.episodeCount) * 100)
                  : 0
              const barColor =
                pct === 100
                  ? 'bg-green-600'
                  : pct >= 80
                    ? 'bg-blue-600'
                    : pct >= 50
                      ? 'bg-yellow-600'
                      : 'bg-red-700'

              return (
                <Link
                  key={season.id}
                  to={`/shows/${show.id}/season/${season.seasonNumber}`}
                  className="bg-surface-raised border border-gray-700 hover:border-accent/60 rounded-lg p-3 space-y-2 transition-colors"
                >
                  <p className="text-sm font-medium">Season {season.seasonNumber}</p>
                  <div className="h-1 rounded-full bg-gray-700 overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-gray-500">
                    {season.ownedCount}/{season.episodeCount} episodes
                  </p>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Cast */}
      {(cast.length > 0 || directors.length > 0) && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Cast</h2>
          {directors.length > 0 && (
            <p className="text-sm text-gray-400 mb-2">
              <span className="text-gray-500">Creators: </span>
              {directors.map((c) => c.person.name).join(', ')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {cast.map((c) => (
              <div key={c.id} className="text-xs bg-surface-raised border border-gray-700 rounded px-2 py-1">
                <span className="text-gray-100">{c.person.name}</span>
                {c.character && (
                  <span className="text-gray-500 ml-1">as {c.character}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Organize */}
      <OrganizePanel showId={show.id} onDone={load} />

      {/* Artwork */}
      <ArtworkManager
        posterDownloaded={show.posterDownloaded}
        backdropDownloaded={show.backdropDownloaded}
        api={{
          download: (type) => triggerShowDownload(show.id, type),
          searchImages: () => fetchShowImages(show.id),
          selectImage: (filePath, artworkType) => selectShowImage(show.id, filePath, artworkType),
        }}
        onUpdated={() => { load(); setArtworkVersion((v) => v + 1) }}
      />

      {showMatchModal && (
        <MatchModal
          mediaType="show"
          id={show.id}
          currentTitle={show.title}
          currentTmdbId={show.tmdbId}
          fetchCandidates={fetchShowCandidates}
          onMatch={matchShow}
          onClose={() => setShowMatchModal(false)}
          onMatched={() => { setShowMatchModal(false); load() }}
        />
      )}
    </div>
  )
}

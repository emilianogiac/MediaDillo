import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { MovieDetail, MovieFile } from '../api/types.js'
import { fetchMovie, triggerMovieDownload, fetchMovieImages, selectMovieImage, fetchMovieCandidates, matchMovie, deleteMovie, rescanMovie, setMovieFileOrder, moveMovie, updateFileEdition, fetchEditions, renameEdition } from '../api/movies.js'
import { fetchScanRoots } from '../api/movies.js'
import type { ScanRoot } from '../api/types.js'
import { TechBadge } from '../components/TechBadge.js'
import { ArtworkManager } from '../components/ArtworkManager.js'
import { MatchModal } from '../components/MatchModal.js'
import { MovieFilesPanel } from '../components/MovieFilesPanel.js'
import { MovieFolderCleanupPanel } from '../components/MovieFolderCleanupPanel.js'
import { useToast } from '../context/ToastContext.js'

function formatSize(bytes: number | null): string {
  if (!bytes) return '—'
  const gb = bytes / 1_073_741_824
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1_048_576).toFixed(0)} MB`
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function MovieDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [movie, setMovie] = useState<MovieDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMatchModal, setShowMatchModal] = useState(false)
  const [rematching, setRematching] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [rescanResult, setRescanResult] = useState<string | null>(null)
  const [fileOrder, setFileOrder] = useState<MovieFile[]>([])
  const [savingOrder, setSavingOrder] = useState(false)
  const [scanRoots, setScanRoots] = useState<ScanRoot[]>([])
  const [moving, setMoving] = useState(false)
  const [moveTarget, setMoveTarget] = useState('')
  const [artworkVersion, setArtworkVersion] = useState(() => Date.now())
  const [cleanupTrigger, setCleanupTrigger] = useState(0)
  const [editingEditionFileId, setEditingEditionFileId] = useState<string | null>(null)
  const [editionInput, setEditionInput] = useState('')
  const [savingEdition, setSavingEdition] = useState(false)
  const [editions, setEditions] = useState<string[]>([])
  const [editingGlobalEdition, setEditingGlobalEdition] = useState<string | null>(null)
  const [globalRenameInput, setGlobalRenameInput] = useState('')
  const [renamingGlobal, setRenamingGlobal] = useState(false)

  async function handleDelete() {
    if (!id || !window.confirm('Delete this record? This cannot be undone.')) return
    setDeleting(true)
    try {
      await deleteMovie(id)
      navigate(-1)
    } catch {
      setDeleting(false)
    }
  }

  const load = useCallback(() => {
    if (!id) return Promise.resolve()
    setLoading(true)
    return fetchMovie(id)
      .then((m) => { setMovie(m); setFileOrder(m.files) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [id])

  async function handleRescan() {
    if (!id) return
    setRescanning(true)
    setRescanResult(null)
    try {
      const r = await rescanMovie(id)
      const parts = [r.added > 0 && `${r.added} added`, r.changed > 0 && `${r.changed} changed`, r.removed > 0 && `${r.removed} removed`].filter(Boolean)
      setRescanResult(parts.length > 0 ? parts.join(', ') : 'Up to date')
      setCleanupTrigger((n) => n + 1)
      load()
    } catch {
      setRescanResult('Rescan failed')
      toast({ type: 'error', message: 'Rescan failed' })
    } finally {
      setRescanning(false)
    }
  }

  async function handleRematch() {
    if (!id || !movie?.tmdbId) return
    setRematching(true)
    try {
      await matchMovie(id, movie.tmdbId)
      await load()
      setArtworkVersion(Date.now())
      toast({ type: 'success', message: 'Metadata refreshed from TMDB' })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Rematch failed' })
    } finally {
      setRematching(false)
    }
  }

  async function handleSaveEdition(fileId: string) {
    setSavingEdition(true)
    try {
      await updateFileEdition(fileId, editionInput.trim() || null)
      load()
      fetchEditions().then(setEditions).catch(() => {})
      toast({ type: 'success', message: 'Edition updated' })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to save edition' })
    } finally {
      setSavingEdition(false)
      setEditingEditionFileId(null)
      setEditionInput('')
      setEditingGlobalEdition(null)
      setGlobalRenameInput('')
    }
  }

  function openEditionPicker(fileId: string, currentEdition: string) {
    setEditingEditionFileId(fileId)
    setEditionInput(currentEdition)
    setEditingGlobalEdition(null)
    setGlobalRenameInput('')
    fetchEditions().then(setEditions).catch(() => {})
  }

  function closeEditionPicker() {
    setEditingEditionFileId(null)
    setEditionInput('')
    setEditingGlobalEdition(null)
    setGlobalRenameInput('')
  }

  async function handleGlobalRename(from: string) {
    const to = globalRenameInput.trim() || null
    if (to === from) { setEditingGlobalEdition(null); return }
    setRenamingGlobal(true)
    try {
      const r = await renameEdition(from, to)
      load()
      const fresh = await fetchEditions()
      setEditions(fresh)
      setEditingGlobalEdition(null)
      setGlobalRenameInput('')
      if (editionInput === from) setEditionInput(to ?? '')
      toast({ type: 'success', message: `Renamed "${from}" on ${r.updated} file${r.updated !== 1 ? 's' : ''}` })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Rename failed' })
    } finally {
      setRenamingGlobal(false)
    }
  }

  function moveFile(index: number, dir: -1 | 1) {
    const next = [...fileOrder]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setFileOrder(next)
  }

  async function handleSaveOrder() {
    if (!id) return
    setSavingOrder(true)
    try {
      await setMovieFileOrder(id, fileOrder.map((f) => f.id))
      load()
    } finally {
      setSavingOrder(false)
    }
  }

  async function handleMove() {
    if (!id || !moveTarget) return
    setMoving(true)
    try {
      await moveMovie(id, moveTarget)
      load()
      setMoveTarget('')
    } catch {
      // error visible via load failure
    } finally {
      setMoving(false)
    }
  }

  useEffect(() => { load() }, [load])
  useEffect(() => { fetchScanRoots().then(setScanRoots).catch(() => {}) }, [])

  if (loading) {
    return <div className="p-6 text-gray-500">Loading…</div>
  }
  if (error || !movie) {
    return (
      <div className="p-6 text-red-400">
        {error ?? 'Movie not found'}
        <button onClick={() => navigate(-1)} className="block mt-2 text-sm text-accent hover:underline">
          ← Back to Movies
        </button>
      </div>
    )
  }

  const directors = movie.credits.filter((c) => c.role === 'director')
  const cast = movie.credits.filter((c) => c.role === 'cast').slice(0, 12)

  return (
    <div className="p-6 space-y-8 max-w-5xl">
      {/* Back link */}
      <button onClick={() => navigate(-1)} className="text-sm text-gray-400 hover:text-accent transition-colors">
        ← Movies
      </button>

      {/* Hero section */}
      <div className="flex gap-6">
        {/* Poster */}
        <div className="flex-shrink-0 self-start w-36 rounded-lg overflow-hidden bg-gray-800 border border-gray-700">
          {(movie.posterDownloaded || movie.posterUrl) ? (
            <img
              src={movie.posterDownloaded ? `/api/artwork/movies/${movie.id}/poster?v=${artworkVersion}` : movie.posterUrl!}
              alt={movie.title}
              className="w-full object-cover"
            />
          ) : (
            <div className="aspect-[2/3] flex items-center justify-center text-gray-600 text-xs text-center px-2">
              No Poster
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="flex-1 space-y-3">
          <div>
            <h1 className="text-3xl font-bold">{movie.title}</h1>
            {movie.tagline && (
              <p className="text-gray-400 italic mt-0.5">{movie.tagline}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-3 text-sm text-gray-400">
            {movie.year && <span>{movie.year}</span>}
            {movie.runtime && <span>{movie.runtime} min</span>}
            {movie.rating !== null && (
              <span className="text-yellow-400">★ {movie.rating.toFixed(1)}</span>
            )}
            {movie.scanRoot && (
              <span className="text-gray-500">{movie.scanRoot.label}</span>
            )}
            {(() => {
              const targets = scanRoots.filter((r) => r.type === 'movies' && r.id !== movie.scanRoot?.id)
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

          {movie.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {movie.genres.map((g) => (
                <span key={g} className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                  {g}
                </span>
              ))}
            </div>
          )}

          {movie.overview && (
            <p className="text-sm text-gray-300 leading-relaxed max-w-2xl">{movie.overview}</p>
          )}

          {directors.length > 0 && (
            <p className="text-sm text-gray-400">
              <span className="text-gray-500">Director: </span>
              {directors.map((c) => c.person.name).join(', ')}
            </p>
          )}

          {/* External links + match button */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-2 text-xs">
              {movie.tmdbId && (
                <a
                  href={`https://www.themoviedb.org/movie/${movie.tmdbId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-0.5 rounded bg-gray-700/60 text-accent hover:underline"
                >
                  TMDB ↗
                </a>
              )}
              {movie.imdbId && (
                <a
                  href={`https://www.imdb.com/title/${movie.imdbId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-0.5 rounded bg-gray-700/60 text-accent hover:underline"
                >
                  IMDb ↗
                </a>
              )}
            </div>
            {movie.tmdbId ? (
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
          </div>
        </div>
      </div>

      {/* Cast */}
      {cast.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Cast</h2>
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

      {/* Files */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Files</h2>
          <div className="flex items-center gap-2">
            {rescanResult && <span className="text-xs text-gray-400">{rescanResult}</span>}
            <button
              onClick={handleRescan}
              disabled={rescanning}
              className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors disabled:opacity-40"
            >
              {rescanning ? 'Rescanning…' : 'Rescan folder'}
            </button>
          </div>
        </div>

        {movie.files.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-red-400 font-medium">⚠ No video file attached to this record.</p>
            <p className="text-sm text-gray-500">This is a stale record — the file was likely deleted or moved without re-scanning. You can safely remove it.</p>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm px-3 py-1.5 rounded border border-red-700/60 text-red-400 hover:bg-red-700/20 transition-colors disabled:opacity-40"
            >
              {deleting ? 'Deleting…' : 'Delete this record'}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {fileOrder.map((file, idx) => (
              <div
                key={file.id}
                className="bg-surface-raised border border-gray-700 rounded-lg px-4 py-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  {editingEditionFileId !== file.id && file.edition ? (
                    <button
                      onClick={() => openEditionPicker(file.id, file.edition ?? '')}
                      className="flex items-center gap-1 group shrink-0"
                      title="Edit edition"
                    >
                      <TechBadge label={file.edition} variant="edition" />
                      <span className="text-gray-600 group-hover:text-gray-400 text-xs">✎</span>
                    </button>
                  ) : editingEditionFileId !== file.id && fileOrder.length > 1 ? (
                    <span className="text-xs text-gray-500 font-mono w-12 shrink-0">part {idx + 1}</span>
                  ) : null}
                  {editingEditionFileId !== file.id && !file.edition && (
                    <button
                      onClick={() => openEditionPicker(file.id, '')}
                      className="text-xs px-1.5 py-0.5 rounded border border-dashed border-gray-700 text-gray-500 hover:border-teal-600/60 hover:text-teal-400 transition-colors shrink-0"
                      title="Set edition label"
                    >
                      ＋ edition
                    </button>
                  )}
                  <p className="text-xs text-gray-400 font-mono break-all flex-1">{file.path}</p>
                  {fileOrder.length > 1 && (
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        onClick={() => moveFile(idx, -1)}
                        disabled={idx === 0}
                        className="text-gray-500 hover:text-accent disabled:opacity-20 leading-none"
                        title="Move up"
                      >▲</button>
                      <button
                        onClick={() => moveFile(idx, 1)}
                        disabled={idx === fileOrder.length - 1}
                        className="text-gray-500 hover:text-accent disabled:opacity-20 leading-none"
                        title="Move down"
                      >▼</button>
                    </div>
                  )}
                </div>
                {/* Edition picker panel */}
                {editingEditionFileId === file.id && (
                  <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-3 space-y-3">
                    {/* Input for this file */}
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={editionInput}
                        onChange={(e) => setEditionInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleSaveEdition(file.id)
                          if (e.key === 'Escape') closeEditionPicker()
                        }}
                        placeholder="e.g. Director's Cut"
                        className="flex-1 bg-gray-800 border border-accent/60 rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-600 focus:outline-none"
                      />
                      <button onClick={() => void handleSaveEdition(file.id)} disabled={savingEdition} className="text-xs px-2.5 py-1 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 disabled:opacity-40 transition-colors">
                        {savingEdition ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={closeEditionPicker} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
                    </div>

                    {/* Existing editions */}
                    {editions.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-500">Existing editions — click to reuse, ✎ to rename globally:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {editions.map((ed) => (
                            <div key={ed} className="flex items-center gap-0.5">
                              <button
                                onClick={() => setEditionInput(ed)}
                                className={`text-xs px-2 py-0.5 rounded border transition-colors ${editionInput === ed ? 'bg-teal-700/60 border-teal-500/60 text-teal-100' : 'bg-teal-900/30 border-teal-700/40 text-teal-300 hover:bg-teal-800/50'}`}
                              >
                                {ed}
                              </button>
                              <button
                                onClick={() => { setEditingGlobalEdition(ed); setGlobalRenameInput(ed) }}
                                title={`Rename "${ed}" on all movies`}
                                className="text-xs text-gray-600 hover:text-gray-300 px-0.5 transition-colors"
                              >
                                ✎
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Global rename inline */}
                        {editingGlobalEdition && (
                          <div className="border-t border-gray-700 pt-2 space-y-1.5">
                            <p className="text-xs text-gray-400">Rename <span className="text-teal-300">"{editingGlobalEdition}"</span> across all movies:</p>
                            <div className="flex items-center gap-2">
                              <input
                                autoFocus
                                value={globalRenameInput}
                                onChange={(e) => setGlobalRenameInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void handleGlobalRename(editingGlobalEdition)
                                  if (e.key === 'Escape') { setEditingGlobalEdition(null); setGlobalRenameInput('') }
                                }}
                                placeholder="New edition name…"
                                className="flex-1 bg-gray-800 border border-teal-700/60 rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-600 focus:outline-none"
                              />
                              <button
                                onClick={() => void handleGlobalRename(editingGlobalEdition)}
                                disabled={renamingGlobal || !globalRenameInput.trim()}
                                className="text-xs px-2.5 py-1 rounded bg-teal-800/40 border border-teal-600/40 text-teal-200 hover:bg-teal-700/50 disabled:opacity-40 transition-colors"
                              >
                                {renamingGlobal ? 'Renaming…' : 'Rename all'}
                              </button>
                              <button onClick={() => { setEditingGlobalEdition(null); setGlobalRenameInput('') }} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 items-center">
                  {file.videoQualityTier && (
                    <TechBadge label={file.videoQualityTier} variant="quality" />
                  )}
                  {file.hdr && <TechBadge label="HDR" variant="hdr" />}
                  {file.videoCodec && <TechBadge label={file.videoCodec} />}
                  {file.videoResolution && (
                    <TechBadge label={file.videoResolution} />
                  )}
                  {file.audioCodec && <TechBadge label={file.audioCodec} />}
                  {file.audioChannels && <TechBadge label={file.audioChannels} />}
                  {file.audioQualityTier && (
                    <TechBadge label={file.audioQualityTier} />
                  )}
                  <span className="text-xs text-gray-500 ml-auto">
                    {formatSize(Number(file.sizeBytes))}
                    {file.durationS ? ` · ${formatDuration(file.durationS)}` : ''}
                  </span>
                </div>
              </div>
            ))}
            {fileOrder.length > 1 && (
              <button
                onClick={handleSaveOrder}
                disabled={savingOrder}
                className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors disabled:opacity-40"
              >
                {savingOrder ? 'Saving…' : 'Save file order'}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Rename & Organize */}
      {movie.files.length > 0 && (
        <MovieFilesPanel movieId={movie.id} onDone={() => { load(); setCleanupTrigger((n) => n + 1) }} />
      )}

      {/* Folder cleanup */}
      {movie.files.length > 0 && (
        <MovieFolderCleanupPanel movieId={movie.id} autoScanTrigger={cleanupTrigger} />
      )}

      {/* Artwork Manager */}
      <ArtworkManager
        posterDownloaded={movie.posterDownloaded}
        backdropDownloaded={movie.backdropDownloaded}
        api={{
          download: (type) => triggerMovieDownload(movie.id, type),
          searchImages: () => fetchMovieImages(movie.id),
          selectImage: (filePath, artworkType) => selectMovieImage(movie.id, filePath, artworkType),
        }}
        onUpdated={() => { load(); setArtworkVersion((v) => v + 1) }}
      />

      {showMatchModal && (
        <MatchModal
          mediaType="movie"
          id={movie.id}
          currentTitle={movie.title}
          currentTmdbId={movie.tmdbId}
          fetchCandidates={fetchMovieCandidates}
          onMatch={matchMovie}
          onClose={() => setShowMatchModal(false)}
          onMatched={() => { setShowMatchModal(false); void load().then(() => setArtworkVersion(Date.now())) }}
        />
      )}
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import type { ShowDetail, ShowSummary } from '../api/types.js'
import type { ScanRoot } from '../api/types.js'
import { fetchShow, fetchShows, triggerShowDownload, fetchShowImages, selectShowImage, fetchShowCandidates, matchShow, enrichShow, updateShowMetadata, fetchTvdbOrders, moveShow, deleteShow, deleteShowWithFiles, renameAllShowEpisodes, rescanShow, cleanupStaleFiles, fetchOrganizePreview, fetchTvdbCandidates, matchShowFromTvdb, consolidateShow, dismissShowDuplicate, undismissShowDuplicate, type RescanResult } from '../api/shows.js'
import { fetchScanRoots } from '../api/movies.js'
import { fetchJellyfinStatus, fetchJellyfinShowUrl } from '../api/jellyfin.js'
import { ArtworkManager } from '../components/ArtworkManager.js'
import { MatchModal } from '../components/MatchModal.js'
import { OrganizePanel } from '../components/OrganizePanel.js'
import { useToast } from '../context/ToastContext.js'
import { ConfirmModal } from '../components/ConfirmModal.js'
import { TechBadge } from '../components/TechBadge.js'

function Spinner() {
  return <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-600 border-t-accent animate-spin flex-shrink-0" />
}

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
  const stateFrom = (location.state as { from?: string } | null)?.from
  const backToShows = `/shows${stateFrom ?? (() => { try { return sessionStorage.getItem('mediaDillo.showsSearch') ?? '' } catch { return '' } })()}`
  const { toast } = useToast()
  const [show, setShow] = useState<ShowDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMatchModal, setShowMatchModal] = useState(false)
  const [rematching, setRematching] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [scanRoots, setScanRoots] = useState<ScanRoot[]>([])
  const [moving, setMoving] = useState(false)
  const [moveTarget, setMoveTarget] = useState('')
  const [artworkVersion, setArtworkVersion] = useState(() => Date.now())
  const [rescanning, setRescanning] = useState(false)
  const [rescanResult, setRescanResult] = useState<RescanResult | null>(null)
  const [rescanError, setRescanError] = useState<string | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [cleanupStatus, setCleanupStatus] = useState<{ type: 'success' | 'error'; message: string; errors?: string[] } | null>(null)
  const [rematchStatus, setRematchStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [renameStatus, setRenameStatus] = useState<{ type: 'success' | 'error'; message: string; errors?: string[] } | null>(null)
  const [editingTvdbId, setEditingTvdbId] = useState(false)
  const [tvdbIdInput, setTvdbIdInput] = useState('')
  const [savingTvdbId, setSavingTvdbId] = useState(false)
  const [tvdbOrders, setTvdbOrders] = useState<{ type: string; name: string }[]>([])
  const [organizeDots, setOrganizeDots] = useState<{ renames: boolean; removals: boolean } | null>(null)
  const [organizeTrigger, setOrganizeTrigger] = useState(0)
  const [jellyfinConfigured, setJellyfinConfigured] = useState(false)
  const [openingJellyfin, setOpeningJellyfin] = useState(false)
  const [siblings, setSiblings] = useState<ShowSummary[]>([])
  const [consolidateTarget, setConsolidateTarget] = useState<ShowSummary | null>(null)
  const [consolidating, setConsolidating] = useState(false)
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [deletingSiblingId, setDeletingSiblingId] = useState<string | null>(null)

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
  useEffect(() => { fetchJellyfinStatus().then((s) => setJellyfinConfigured(s.configured && s.connected)).catch(() => {}) }, [])
  useEffect(() => {
    if (!id || !show?.tvdbId) { setTvdbOrders([]); return }
    fetchTvdbOrders(id).then(setTvdbOrders).catch(() => setTvdbOrders([]))
  }, [id, show?.tvdbId])
  useEffect(() => {
    if (!show?.tmdbId) { setSiblings([]); return }
    fetchShows({ tmdbId: show.tmdbId })
      .then((all) => setSiblings(all.filter((s) => s.id !== show.id)))
      .catch(() => setSiblings([]))
  }, [show?.tmdbId, show?.id])

  async function loadOrganizeDots() {
    if (!id) return
    try {
      const preview = await fetchOrganizePreview(id)
      const episodeRenames = preview.renames.filter((r) => r.type === 'episode-file')
      setOrganizeDots({ renames: episodeRenames.length > 0, removals: preview.removals.length > 0 })
    } catch { /* silent — dots just won't show */ }
  }

  useEffect(() => { void loadOrganizeDots() }, [id])  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleOpenInJellyfin() {
    if (!id) return
    setOpeningJellyfin(true)
    try {
      const { url } = await fetchJellyfinShowUrl(id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      toast({ type: 'error', message: 'Show not found in Jellyfin — try triggering a library refresh first' })
    } finally {
      setOpeningJellyfin(false)
    }
  }

  async function handleConsolidate() {
    if (!consolidateTarget || !id) return
    setConsolidating(true)
    try {
      const r = await consolidateShow(id, consolidateTarget.id)
      toast({ type: 'success', message: `Consolidated ${r.consolidated} file${r.consolidated !== 1 ? 's' : ''} into this show's folder` })
      setSiblings((prev) => prev.filter((s) => s.id !== consolidateTarget.id))
      setConsolidateTarget(null)
      load()
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Consolidate failed' })
    } finally {
      setConsolidating(false)
    }
  }

  async function handleDismiss(siblingId: string) {
    setDismissingId(siblingId)
    try {
      await dismissShowDuplicate(siblingId)
      setSiblings((prev) => prev.map((s) => s.id === siblingId ? { ...s, dismissedAsDuplicate: true } : s))
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Dismiss failed' })
    } finally {
      setDismissingId(null)
    }
  }

  async function handleUndismiss(siblingId: string) {
    setDismissingId(siblingId)
    try {
      await undismissShowDuplicate(siblingId)
      setSiblings((prev) => prev.map((s) => s.id === siblingId ? { ...s, dismissedAsDuplicate: false } : s))
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Undo dismiss failed' })
    } finally {
      setDismissingId(null)
    }
  }

  function handleDeleteSibling(siblingId: string) {
    const sibling = siblings.find((s) => s.id === siblingId)
    const label = sibling?.title ?? 'this copy'
    setConfirm({
      title: 'Delete duplicate copy',
      message: `Permanently delete "${label}" and its episode files from disk? This cannot be undone.`,
      onConfirm: async () => {
        setConfirm(null)
        setDeletingSiblingId(siblingId)
        try {
          if ((sibling?.ownedEpisodes ?? 0) > 0) {
            await deleteShowWithFiles(siblingId)
          } else {
            await deleteShow(siblingId)
          }
          setSiblings((prev) => prev.filter((s) => s.id !== siblingId))
          toast({ type: 'success', message: 'Duplicate copy deleted' })
        } catch (e) {
          toast({ type: 'error', message: e instanceof Error ? e.message : 'Delete failed' })
        } finally {
          setDeletingSiblingId(null)
        }
      },
    })
  }

  async function handleRematch() {
    if (!id || (!show?.tmdbId && !show?.tvdbId)) return
    setRematching(true)
    setRematchStatus(null)
    try {
      await enrichShow(id)
      load()
      setRematchStatus({ type: 'success', message: 'Metadata refreshed' })
    } catch (e) {
      setRematchStatus({ type: 'error', message: e instanceof Error ? e.message : 'Refresh failed' })
    } finally {
      setRematching(false)
    }
  }

  async function handleSaveTvdbId() {
    if (!id) return
    const parsed = tvdbIdInput.trim() === '' ? null : parseInt(tvdbIdInput.trim(), 10)
    if (tvdbIdInput.trim() !== '' && (isNaN(parsed as number) || (parsed as number) <= 0)) {
      toast({ type: 'error', message: 'TVDB ID must be a positive number' })
      return
    }
    setSavingTvdbId(true)
    try {
      const updated = await updateShowMetadata(id, { tvdbId: parsed })
      setShow(updated)
      setEditingTvdbId(false)
      toast({ type: 'success', message: parsed ? `TVDB ID set to ${parsed} — re-enriching episodes…` : 'TVDB ID cleared' })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to save TVDB ID' })
    } finally {
      setSavingTvdbId(false)
    }
  }

  async function handleRenameAll() {
    if (!id) return
    setRenaming(true)
    setRenameStatus(null)
    try {
      const result = await renameAllShowEpisodes(id)
      if (result.renamed === 0) {
        setRenameStatus({ type: 'success', message: 'All filenames are already canonical' })
      } else {
        setRenameStatus({
          type: result.errors.length > 0 ? 'error' : 'success',
          message: `${result.renamed} file${result.renamed !== 1 ? 's' : ''} renamed${result.errors.length > 0 ? ` — ${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}` : ''}`,
          ...(result.errors.length > 0 ? { errors: result.errors } : {}),
        })
        load()
        setOrganizeTrigger((n) => n + 1)
        void loadOrganizeDots()
      }
    } catch (e) {
      setRenameStatus({ type: 'error', message: e instanceof Error ? e.message : 'Rename failed' })
    } finally {
      setRenaming(false)
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

  async function handleRescan() {
    if (!id) return
    setRescanning(true)
    setRescanResult(null)
    setRescanError(null)
    try {
      const result = await rescanShow(id)
      setRescanResult(result)
    } catch (e) {
      setRescanError(e instanceof Error ? e.message : 'Rescan failed')
    } finally {
      setRescanning(false)
      load()
    }
  }

  async function handleCleanup() {
    if (!id) return
    setCleaning(true)
    setCleanupStatus(null)
    try {
      const result = await cleanupStaleFiles(id)
      if (result.trashed === 0 && result.errors.length === 0) {
        setCleanupStatus({ type: 'success', message: 'No stale files found' })
      } else {
        setCleanupStatus({
          type: result.errors.length > 0 ? 'error' : 'success',
          message: `${result.trashed} stale file${result.trashed !== 1 ? 's' : ''} removed${result.errors.length > 0 ? ` — ${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}` : ''}`,
          ...(result.errors.length > 0 ? { errors: result.errors } : {}),
        })
        setOrganizeTrigger((n) => n + 1)
        void loadOrganizeDots()
      }
    } catch (e) {
      setCleanupStatus({ type: 'error', message: e instanceof Error ? e.message : 'Cleanup failed' })
    } finally {
      setCleaning(false)
    }
  }

  function handleDelete() {
    if (!id) return
    setConfirm({
      title: 'Remove record',
      message: 'Remove this show from the database? Files on disk are not affected.',
      onConfirm: async () => {
        setConfirm(null)
        setDeleting(true)
        try {
          await deleteShow(id)
          navigate(backToShows, { replace: true })
        } catch (e) {
          toast({ type: 'error', message: e instanceof Error ? e.message : 'Delete failed' })
          setDeleting(false)
        }
      },
    })
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
    <div className="p-6 space-y-8">
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
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold">{show.title}</h1>
            {!show.tmdbId && show.tvdbId && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/40 border border-blue-700/40 text-blue-300 self-center">TVDB only</span>
            )}
            {organizeDots !== null && !organizeDots.renames && !organizeDots.removals && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 border border-green-700/40 text-green-400 self-center">✓ Organized</span>
            )}
          </div>

          <div className="flex flex-wrap gap-3 text-sm text-gray-400">
            {show.year && <span>{show.year}</span>}
            {show.scanRoots.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-gray-700/60 text-gray-400 border border-gray-600/40 self-center">
                {show.scanRoots.map((r) => r.label).join(', ')}
              </span>
            )}
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

          {show.showFolder && (
            <p className="text-xs text-gray-500 font-mono truncate" title={show.showFolder}>{show.showFolder}</p>
          )}

          {show.repFile && (
            <div className="flex flex-wrap gap-1.5 items-center">
              {show.repFile.videoQualityTier && <TechBadge label={show.repFile.videoQualityTier} variant="quality" />}
              {show.repFile.videoCodec && <span className="text-xs text-gray-500">{show.repFile.videoCodec}</span>}
              {show.repFile.audioCodec && (
                <span className="text-xs text-gray-500">
                  {[show.repFile.audioCodec, show.repFile.audioChannels].filter(Boolean).join(' ')}
                </span>
              )}
            </div>
          )}

          {show.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {show.genres.map((g) => (
                <span key={g} className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                  {g}
                </span>
              ))}
            </div>
          )}

          {(show.tmdbId || show.tvdbId) && (
            <p className="text-xs text-gray-600 space-x-3">
              {show.tmdbId && <span>TMDB: {show.tmdbId}</span>}
              {show.tvdbId && <span>TVDB: {show.tvdbId}</span>}
            </p>
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
              {(show.tmdbId || show.tvdbId) && jellyfinConfigured && (
                <button
                  onClick={() => { void handleOpenInJellyfin() }}
                  disabled={openingJellyfin}
                  className="px-2 py-0.5 rounded bg-purple-900/40 border border-purple-700/40 text-purple-300 hover:text-purple-100 transition-colors disabled:opacity-40"
                >
                  {openingJellyfin ? '…' : 'Jellyfin ↗'}
                </button>
              )}
              {show.tvdbId && !editingTvdbId && (
                <a
                  href={`https://www.thetvdb.com/?tab=series&id=${show.tvdbId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-0.5 rounded bg-gray-700/60 text-accent hover:underline"
                >
                  TVDB ↗
                </a>
              )}
              {editingTvdbId ? (
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    value={tvdbIdInput}
                    onChange={(e) => setTvdbIdInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveTvdbId(); if (e.key === 'Escape') setEditingTvdbId(false) }}
                    placeholder={show.tvdbId ? String(show.tvdbId) : 'TVDB series ID'}
                    className="w-28 text-xs bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-gray-200 focus:outline-none focus:border-accent/60"
                    autoFocus
                    disabled={savingTvdbId}
                  />
                  <button onClick={() => void handleSaveTvdbId()} disabled={savingTvdbId} className="text-xs text-accent hover:underline disabled:opacity-40">Save</button>
                  <button onClick={() => setEditingTvdbId(false)} className="text-xs text-gray-500 hover:text-gray-300">✕</button>
                </span>
              ) : (
                <button
                  onClick={() => { setTvdbIdInput(show.tvdbId ? String(show.tvdbId) : ''); setEditingTvdbId(true) }}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                  title={show.tvdbId ? 'Change TVDB ID' : 'Set TVDB ID manually'}
                >
                  {show.tvdbId ? '✎' : '+ TVDB ID'}
                </button>
              )}
              {show.tvdbId && tvdbOrders.length > 0 && (
                <select
                  value={show.tvdbOrder ?? 'official'}
                  onChange={async (e) => {
                    if (!id) return
                    const label = tvdbOrders.find((o) => o.type === e.target.value)?.name ?? e.target.value
                    await updateShowMetadata(id, { tvdbOrder: e.target.value })
                    toast({ type: 'success', message: `Switching to ${label} — re-enriching…` })
                    try {
                      const enriched = await enrichShow(id)
                      setShow(enriched)
                      toast({ type: 'success', message: `Now using ${label}` })
                    } catch {
                      toast({ type: 'error', message: 'Re-enrich failed — order saved, refresh manually' })
                    }
                  }}
                  className="text-xs bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-gray-300"
                  title="TVDB episode ordering"
                >
                  {tvdbOrders.map((o) => (
                    <option key={o.type} value={o.type}>{o.name}</option>
                  ))}
                </select>
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
            {(show.tmdbId || show.tvdbId) ? (
              <>
                <button
                  onClick={() => { void handleRematch() }}
                  disabled={rematching}
                  className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors disabled:opacity-40 flex items-center gap-1.5"
                  title={show.tmdbId ? 'Refresh metadata from TMDB/TVDB' : 'Refresh metadata from TVDB'}
                >
                  {rematching && <Spinner />}
                  {rematching ? 'Refreshing…' : 'Re-match'}
                </button>
                <button
                  onClick={() => setShowMatchModal(true)}
                  className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors"
                  title="Assign a different TMDB or TVDB entry"
                >
                  Match
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowMatchModal(true)}
                className="text-xs px-2.5 py-1 rounded border border-yellow-700/60 hover:border-accent/60 text-yellow-400 hover:text-accent transition-colors"
              >
                ⚠ Match show
              </button>
            )}
            <button
              onClick={() => { void handleRenameAll() }}
              disabled={renaming || !organizeDots?.renames}
              className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors disabled:opacity-40 flex items-center gap-1.5"
              title={organizeDots?.renames ? 'Rename all episode files to canonical format' : 'All files already have canonical names'}
            >
              {renaming && <Spinner />}
              {!renaming && organizeDots?.renames && <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
              {renaming ? 'Renaming…' : 'Rename all episodes'}
            </button>
            {(() => {
              // Disable cleanup when files still need renaming — stale detection
              // relies on DB paths matching disk paths. Running cleanup before rename
              // could flag DB-known files as "video not in library" if paths diverge.
              // Also disable while organize data is still loading (organizeDots === null).
              const cleanupBlocked = !organizeDots || organizeDots.renames || !organizeDots.removals
              const cleanupTitle = !organizeDots
                ? 'Loading organize status…'
                : organizeDots.renames
                  ? 'Rename episode files first before running cleanup'
                  : !organizeDots.removals
                    ? 'No stale files or folders to remove'
                    : 'Auto-trash stale and orphaned files from the show folder'
              return (
                <button
                  onClick={() => { void handleCleanup() }}
                  disabled={cleaning || cleanupBlocked}
                  className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors disabled:opacity-40 flex items-center gap-1.5"
                  title={cleanupTitle}
                >
                  {cleaning && <Spinner />}
                  {!cleaning && organizeDots?.removals && <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
                  {cleaning ? 'Cleaning…' : 'Cleanup Show'}
                  {!cleaning && organizeDots?.renames && (
                    <span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" title="Rename first" />
                  )}
                </button>
              )
            })()}
            <button
              onClick={() => { void handleRescan() }}
              disabled={rescanning}
              className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors disabled:opacity-40 flex items-center gap-1.5"
              title="Rescan show folder for new or changed episode files"
            >
              {rescanning && <Spinner />}
              {rescanning ? 'Scanning…' : 'Rescan'}
            </button>
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

      {/* Inline operation status panels */}
      {(rematchStatus || rematching) && (
        <div className={`rounded-lg border px-4 py-3 flex items-center gap-2 text-sm ${rematchStatus?.type === 'error' ? 'bg-red-900/20 border-red-700/40 text-red-400' : 'bg-surface-raised border-gray-700 text-gray-300'}`}>
          {rematching && <Spinner />}
          {rematchStatus && <span>{rematchStatus.type === 'success' ? '✓' : '✗'} {rematchStatus.message}</span>}
          {rematching && <span>Fetching metadata…</span>}
        </div>
      )}

      {(renameStatus || renaming) && (
        <div className={`rounded-lg border px-4 py-3 space-y-2 text-sm ${renameStatus?.type === 'error' ? 'bg-red-900/20 border-red-700/40' : 'bg-surface-raised border-gray-700'}`}>
          {renaming && (
            <div className="flex items-center gap-2 text-gray-400"><Spinner /><span>Renaming episode files…</span></div>
          )}
          {renameStatus && !renaming && (
            <p className={renameStatus.type === 'success' ? 'text-gray-300' : 'text-red-400'}>
              {renameStatus.type === 'success' ? '✓' : '✗'} {renameStatus.message}
            </p>
          )}
          {renameStatus?.errors?.map((e, i) => (
            <p key={i} className="text-xs text-red-400 font-mono">↳ {e}</p>
          ))}
        </div>
      )}

      {(cleanupStatus || cleaning) && (
        <div className={`rounded-lg border px-4 py-3 space-y-2 text-sm ${cleanupStatus?.type === 'error' ? 'bg-red-900/20 border-red-700/40' : 'bg-surface-raised border-gray-700'}`}>
          {cleaning && (
            <div className="flex items-center gap-2 text-gray-400"><Spinner /><span>Scanning for stale files…</span></div>
          )}
          {cleanupStatus && !cleaning && (
            <p className={cleanupStatus.type === 'success' ? 'text-gray-300' : 'text-red-400'}>
              {cleanupStatus.type === 'success' ? '✓' : '✗'} {cleanupStatus.message}
            </p>
          )}
          {cleanupStatus?.errors?.map((e, i) => (
            <p key={i} className="text-xs text-red-400 font-mono">↳ {e}</p>
          ))}
        </div>
      )}

      {(rescanning || rescanError || rescanResult) && (
        <div className={`rounded-lg border px-4 py-3 space-y-2 ${rescanError || (rescanResult && !rescanResult.folderFound) ? 'bg-red-900/20 border-red-700/40' : 'bg-surface-raised border-gray-700'}`}>
          {rescanning && (
            <div className="flex items-center gap-2 text-sm text-gray-400"><Spinner /><span>Scanning show folder…</span></div>
          )}
          {rescanError && <p className="text-sm text-red-400">✗ {rescanError}</p>}
          {rescanResult && !rescanning && (
            <p className={`text-sm ${rescanResult.folderFound ? 'text-gray-300' : 'text-red-400'}`}>
              {!rescanResult.folderFound
                ? '✗ Show folder not found on disk'
                : [
                    `${rescanResult.filesFound} file${rescanResult.filesFound !== 1 ? 's' : ''} scanned`,
                    rescanResult.added > 0 && `${rescanResult.added} added`,
                    rescanResult.changed > 0 && `${rescanResult.changed} changed`,
                    rescanResult.removed > 0 && `${rescanResult.removed} removed`,
                    rescanResult.filesSkipped.length > 0 && `${rescanResult.filesSkipped.length} skipped`,
                  ].filter(Boolean).join(' · ')}
            </p>
          )}
          {rescanResult?.filesSkipped.length ? (
            <div className="space-y-1 pt-1 border-t border-gray-700/60">
              <p className="text-xs font-medium text-yellow-400">Skipped</p>
              {rescanResult.filesSkipped.map((f, i) => (
                <p key={i} className="text-xs text-gray-400 font-mono truncate" title={f.path}>
                  <span className="text-yellow-600">{f.reason}</span>{' — '}{f.path.split('/').pop()}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      )}

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
                  <p className="text-sm font-medium">{season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`}</p>
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

      {/* Duplicate copies */}
      {siblings.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-orange-400">
            Duplicate Copies
            <span className="text-sm font-normal text-gray-500 ml-2">({siblings.length + 1} records share this TMDB ID)</span>
          </h2>
          <div className="bg-surface-raised border border-orange-700/30 rounded-lg divide-y divide-gray-700/60">
            {siblings.filter((s) => !s.dismissedAsDuplicate).map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-200">{s.title}</span>
                    {s.year && <span className="text-xs text-gray-500">({s.year})</span>}
                  </div>
                  {s.scanRoots.length > 0 && (
                    <p className="text-xs text-gray-600">{s.scanRoots.map((r) => r.label).join(', ')}</p>
                  )}
                  <p className="text-xs text-gray-500">{s.ownedEpisodes}/{s.totalEpisodes} episodes owned</p>
                  {s.repFile && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {s.repFile.videoQualityTier && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-teal-400 border border-gray-700">{s.repFile.videoQualityTier}</span>}
                      {s.repFile.videoCodec && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{s.repFile.videoCodec}</span>}
                      {s.repFile.audioCodec && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{s.repFile.audioCodec}</span>}
                    </div>
                  )}
                  {s.ownedEpisodes === 0 && <p className="text-xs text-red-400">No owned episodes (stale record)</p>}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => navigate(`/shows/${s.id}`)}
                    className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors"
                  >
                    Browse →
                  </button>
                  <button
                    onClick={() => setConsolidateTarget(s)}
                    className="text-xs px-2.5 py-1 rounded border border-blue-700/40 text-blue-400 hover:bg-blue-700/20 transition-colors"
                  >
                    Consolidate
                  </button>
                  <button
                    onClick={() => { void handleDismiss(s.id) }}
                    disabled={dismissingId === s.id}
                    className="text-xs px-2.5 py-1 rounded border border-gray-600 text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors disabled:opacity-40"
                  >
                    {dismissingId === s.id ? '…' : 'Dismiss'}
                  </button>
                  <button
                    onClick={() => { void handleDeleteSibling(s.id) }}
                    disabled={deletingSiblingId === s.id}
                    className="text-xs px-2.5 py-1 rounded border border-red-700/40 text-red-500 hover:bg-red-700/20 transition-colors disabled:opacity-40"
                  >
                    {deletingSiblingId === s.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {siblings.filter((s) => s.dismissedAsDuplicate).length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1">Dismissed (intentional duplicates):</p>
              <div className="bg-surface-raised border border-gray-700/40 rounded-lg divide-y divide-gray-700/40">
                {siblings.filter((s) => s.dismissedAsDuplicate).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-4 px-4 py-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-500">{s.title}</span>
                      {s.scanRoots.length > 0 && (
                        <span className="text-xs text-gray-600 ml-2">{s.scanRoots.map((r) => r.label).join(', ')}</span>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => navigate(`/shows/${s.id}`)} className="text-xs text-gray-500 hover:text-accent transition-colors">Browse →</button>
                      <button
                        onClick={() => { void handleUndismiss(s.id) }}
                        disabled={dismissingId === s.id}
                        className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
                      >
                        {dismissingId === s.id ? '…' : 'Undo dismiss'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-gray-600">Consolidate moves files here · Dismiss hides intentional duplicates · Delete removes from disk.</p>
        </section>
      )}

      {/* Consolidate confirmation dialog */}
      {consolidateTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-surface-raised border border-gray-700 rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h2 className="font-semibold text-gray-100">Consolidate into this show?</h2>
            <p className="text-sm text-gray-400">
              Move all episode files from <strong className="text-gray-200">{consolidateTarget.title}</strong> ({consolidateTarget.ownedEpisodes} owned ep{consolidateTarget.ownedEpisodes !== 1 ? 's' : ''}) into this show's folder. The sibling record will be deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConsolidateTarget(null)}
                disabled={consolidating}
                className="text-sm px-4 py-1.5 rounded border border-gray-600 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleConsolidate() }}
                disabled={consolidating}
                className="text-sm px-4 py-1.5 rounded bg-blue-700/80 hover:bg-blue-600/80 text-white transition-colors disabled:opacity-40"
              >
                {consolidating ? 'Consolidating…' : 'Consolidate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Organize */}
      <OrganizePanel showId={show.id} onDone={() => { load(); void loadOrganizeDots() }} refreshTrigger={organizeTrigger} />

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

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel="Remove"
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

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
          fetchTvdbCandidates={fetchTvdbCandidates}
          onMatchTvdb={matchShowFromTvdb}
        />
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams, useLocation } from 'react-router-dom'
import type { ShowSummary, ShowScanRoot, ScanRoot } from '../api/types.js'
import { fetchShows, deleteShow } from '../api/shows.js'
import { fetchScanRoots } from '../api/movies.js'
import { refreshMetadata, cleanupBatch } from '../api/library-health.js'
import { renameBatchShows } from '../api/files.js'
import { SkeletonCard, SkeletonRow } from '../components/SkeletonCard.js'
import { useToast } from '../context/ToastContext.js'
import { ConfirmModal } from '../components/ConfirmModal.js'
import { TechBadge } from '../components/TechBadge.js'

const QUALITY_TIERS = ['360p', '480p', '576p', '720p', '1080p', '1440p', '4K']

const SORT_OPTIONS = [
  { value: 'title_asc', label: 'Title A–Z' },
  { value: 'title_desc', label: 'Title Z–A' },
  { value: 'year_desc', label: 'Newest' },
  { value: 'year_asc', label: 'Oldest' },
  { value: 'rating_desc', label: 'Highest rated' },
  { value: 'completeness_desc', label: 'Most complete' },
]

function completenessColor(owned: number, total: number): string {
  if (total === 0) return 'bg-gray-700'
  const pct = owned / total
  if (pct === 1) return 'bg-green-600'
  if (pct >= 0.8) return 'bg-blue-600'
  if (pct >= 0.5) return 'bg-yellow-600'
  return 'bg-red-700'
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="2" width="14" height="2" rx="1" />
      <rect x="1" y="7" width="14" height="2" rx="1" />
      <rect x="1" y="12" width="14" height="2" rx="1" />
    </svg>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 bg-gray-800 border border-gray-700 text-gray-300 text-xs px-2.5 py-1 rounded-full">
      {label}
      <button
        onClick={onRemove}
        className="text-gray-500 hover:text-white leading-none ml-0.5"
        aria-label={`Remove ${label} filter`}
      >
        ×
      </button>
    </span>
  )
}

// A display entry is a ShowSummary scoped to a specific library (for multi-library splits)
type DisplayShow = ShowSummary & { displayLibrary: ShowScanRoot | null; listKey: string }

function ShowCard({ show, nonce, isNew, listSearch }: { show: DisplayShow; nonce: number; isNew: boolean; listSearch: string }) {
  const unmatched = !show.tmdbId && !show.tvdbId
  const missingArt = !show.posterDownloaded || !show.backdropDownloaded
  const isDuplicate = show.duplicateCount > 1
  const pct = show.totalEpisodes > 0 ? Math.round((show.ownedEpisodes / show.totalEpisodes) * 100) : null

  return (
    <Link
      to={`/shows/${show.id}`}
      state={{ from: listSearch }}
      className="group relative flex flex-col rounded-lg overflow-hidden bg-surface-raised border border-gray-800 hover:border-accent/60 transition-colors"
    >
      <div className="aspect-[2/3] bg-gray-800 overflow-hidden">
        {(show.posterDownloaded || show.posterUrl) ? (
          <img
            src={show.posterDownloaded ? `/api/artwork/shows/${show.id}/poster?v=${nonce}` : show.posterUrl!}
            alt={show.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs text-center px-2">No Poster</div>
        )}
      </div>

      {isNew && (
        <div className="absolute top-1.5 left-1.5">
          <span className="bg-sky-500/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">New</span>
        </div>
      )}

      {(unmatched || missingArt || isDuplicate) && (
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 items-end">
          {unmatched && <span className="bg-red-600/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">Unmatched</span>}
          {!unmatched && missingArt && <span className="bg-yellow-500/90 text-yellow-900 text-xs px-1.5 py-0.5 rounded font-medium">Art missing</span>}
          {isDuplicate && <span className="bg-orange-500/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">{show.duplicateCount}×</span>}
        </div>
      )}

      {show.status === 'continuing' && (
        <div className="absolute bottom-9 left-1.5">
          <span className="bg-green-700/80 text-green-100 text-xs px-1.5 py-0.5 rounded font-medium">Airing</span>
        </div>
      )}

      {show.isOrganized && (
        <div className="absolute bottom-9 right-1.5">
          <span className="bg-green-600/90 text-white text-xs px-1 py-0.5 rounded font-medium">✓</span>
        </div>
      )}

      <div className="p-2 space-y-1.5">
        <p className="text-xs font-medium text-gray-100 truncate">{show.title}</p>
        <p className="text-xs text-gray-500">
          {show.year ?? '—'}
          {show.displayLibrary && <span className="ml-1.5 text-gray-600">{show.displayLibrary.label}</span>}
        </p>
        {show.totalEpisodes > 0 && (
          <div className="space-y-0.5">
            <div className="h-1 rounded-full bg-gray-700 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${completenessColor(show.ownedEpisodes, show.totalEpisodes)}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-gray-500">{show.ownedEpisodes}/{show.totalEpisodes} ep</p>
          </div>
        )}
      </div>
    </Link>
  )
}

interface ListRowProps {
  show: DisplayShow
  selected: boolean
  index: number
  nonce: number
  isNew: boolean
  listSearch: string
  onToggle: (e: React.MouseEvent<HTMLInputElement>) => void
}

function ShowListRow({ show, selected, index, nonce, isNew, listSearch, onToggle }: ListRowProps) {
  const unmatched = !show.tmdbId && !show.tvdbId
  const isDuplicate = show.duplicateCount > 1
  const pct = show.totalEpisodes > 0 ? Math.round((show.ownedEpisodes / show.totalEpisodes) * 100) : null
  const rowBg = index % 2 === 1 ? 'bg-gray-900/30' : ''
  const qualityTier = show.repFile?.videoQualityTier
  const videoCodec = show.repFile?.videoCodec
  const audioLabel = [show.repFile?.audioCodec, show.repFile?.audioChannels].filter(Boolean).join(' ')

  return (
    <div className={`flex items-center group ${rowBg}`}>
      <div className="pl-3 pr-2 flex-shrink-0 flex items-center self-stretch">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => {}}
          onClick={(e) => { e.stopPropagation(); onToggle(e) }}
          className="accent-accent cursor-pointer"
        />
      </div>

      <Link
        to={`/shows/${show.id}`}
        state={{ from: listSearch }}
        className="flex flex-1 items-center gap-3 px-3 py-2 hover:bg-gray-800/40 transition-colors min-w-0"
      >
        <div className="w-8 h-12 flex-shrink-0 rounded overflow-hidden bg-gray-800">
          {(show.posterDownloaded || show.posterUrl) ? (
            <img
              src={show.posterDownloaded ? `/api/artwork/shows/${show.id}/poster?v=${nonce}` : show.posterUrl!}
              alt={show.title}
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gray-700" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-100">{show.title}</p>
          <p className="text-xs text-gray-500">
            {show.year ?? '—'}
            {show.displayLibrary && <span className="ml-2 text-gray-600">{show.displayLibrary.label}</span>}
          </p>
        </div>

        {/* Codec info */}
        <div className="flex-shrink-0 w-14">
          {qualityTier && <TechBadge label={qualityTier} variant="quality" />}
        </div>
        <div className="flex-shrink-0 w-12 text-xs text-gray-500 tabular-nums truncate">
          {videoCodec ?? '—'}
        </div>
        <div className="flex-shrink-0 w-24 text-xs text-gray-500 tabular-nums truncate">
          {audioLabel || '—'}
        </div>

        {/* Completeness bar */}
        <div className="flex-shrink-0 w-24 space-y-0.5">
          {show.totalEpisodes > 0 && (
            <>
              <div className="h-1 rounded-full bg-gray-700 overflow-hidden">
                <div className={`h-full rounded-full ${completenessColor(show.ownedEpisodes, show.totalEpisodes)}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-gray-500 text-right">{show.ownedEpisodes}/{show.totalEpisodes}</p>
            </>
          )}
        </div>

        {/* Airing status */}
        <div className="flex-shrink-0 w-14 text-xs text-gray-500">
          {show.status === 'continuing'
            ? <span className="text-green-400">Airing</span>
            : <span className="text-gray-600">Ended</span>}
        </div>

        {/* Status chips */}
        <div className="flex-shrink-0 w-40 flex gap-1 items-center flex-wrap">
          {isNew && <span className="bg-sky-500/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">New</span>}
          {unmatched && <span className="bg-red-600/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">Unmatched</span>}
          {isDuplicate && <span className="bg-orange-500/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">{show.duplicateCount}×</span>}
          {show.isOrganized
            ? <span className="bg-green-600/90 text-white text-xs px-1 py-0.5 rounded font-medium">✓</span>
            : <span className="bg-yellow-700/60 text-yellow-300 text-xs px-1.5 py-0.5 rounded font-medium">⚠ Organize</span>}
        </div>
      </Link>
    </div>
  )
}

export function ShowsPage() {
  const { toast, trackJob } = useToast()
  const location = useLocation()
  const [shows, setShows] = useState<ShowSummary[]>([])
  const [scanRoots, setScanRoots] = useState<ScanRoot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [listNonce, setListNonce] = useState(() => Date.now())
  const searchRef = useRef<HTMLInputElement>(null)

  const [selected, setSelected] = useState<Set<string>>(() => {
    try { const s = sessionStorage.getItem('mediaDillo.showsSelected'); return s ? new Set(JSON.parse(s) as string[]) : new Set() } catch { return new Set() }
  })
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null)
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

  const [lastScanAt, setLastScanAt] = useState<string | null>(() => localStorage.getItem('mediaDillo.lastScanAt'))

  const rawDuplicates = searchParams.get('duplicates')
  const rawStatus = searchParams.get('status')
  const filter = {
    scanRootId: searchParams.get('root') ?? '',
    search: searchParams.get('q') ?? '',
    genre: searchParams.get('genre') ?? '',
    qualityTier: searchParams.get('quality') ?? '',
    missingArtwork: searchParams.has('missing'),
    unmatched: searchParams.has('unmatched'),
    needsOrganizing: searchParams.has('unorganized'),
    duplicates: (rawDuplicates === 'only' || rawDuplicates === 'hide') ? rawDuplicates as 'only' | 'hide' : undefined,
    status: (rawStatus === 'continuing' || rawStatus === 'ended') ? rawStatus as 'continuing' | 'ended' : undefined,
    newOnly: searchParams.has('new'),
    view: searchParams.get('view') === 'list' ? 'list' as const : 'grid' as const,
    sort: searchParams.get('sort') ?? 'title_asc',
  }

  function setPartial(partial: {
    scanRootId?: string
    search?: string
    genre?: string
    qualityTier?: string
    missingArtwork?: boolean
    unmatched?: boolean
    needsOrganizing?: boolean
    duplicates?: 'only' | 'hide' | ''
    status?: 'continuing' | 'ended' | ''
    newOnly?: boolean
    view?: 'grid' | 'list'
    sort?: string
  }) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if ('scanRootId' in partial) { partial.scanRootId ? next.set('root', partial.scanRootId) : next.delete('root') }
        if ('search' in partial) { partial.search ? next.set('q', partial.search) : next.delete('q') }
        if ('genre' in partial) { partial.genre ? next.set('genre', partial.genre) : next.delete('genre') }
        if ('qualityTier' in partial) { partial.qualityTier ? next.set('quality', partial.qualityTier) : next.delete('quality') }
        if ('missingArtwork' in partial) { partial.missingArtwork ? next.set('missing', '1') : next.delete('missing') }
        if ('unmatched' in partial) { partial.unmatched ? next.set('unmatched', '1') : next.delete('unmatched') }
        if ('needsOrganizing' in partial) { partial.needsOrganizing ? next.set('unorganized', '1') : next.delete('unorganized') }
        if ('duplicates' in partial) { partial.duplicates ? next.set('duplicates', partial.duplicates) : next.delete('duplicates') }
        if ('status' in partial) { partial.status ? next.set('status', partial.status) : next.delete('status') }
        if ('newOnly' in partial) { partial.newOnly ? next.set('new', '1') : next.delete('new') }
        if ('view' in partial) { partial.view === 'list' ? next.set('view', 'list') : next.delete('view') }
        if ('sort' in partial) { partial.sort && partial.sort !== 'title_asc' ? next.set('sort', partial.sort) : next.delete('sort') }
        return next
      },
      { replace: true },
    )
  }

  useEffect(() => {
    fetchScanRoots()
      .then((roots) => setScanRoots(roots.filter((r) => r.type === 'tv')))
      .catch(() => {})
  }, [])

  function load(silent = false) {
    if (!silent) setLoading(true)
    setError(null)
    const showFilter: import('../api/shows.js').ShowsFilter = {}
    if (filter.scanRootId) showFilter.scanRootId = filter.scanRootId
    if (filter.search) showFilter.search = filter.search
    if (filter.qualityTier) showFilter.qualityTier = filter.qualityTier
    if (filter.missingArtwork) showFilter.missingArtwork = true
    if (filter.unmatched) showFilter.unmatched = true
    if (filter.needsOrganizing) showFilter.organized = false
    if (filter.duplicates) showFilter.duplicates = filter.duplicates
    if (filter.status) showFilter.status = filter.status
    if (filter.newOnly && lastScanAt) showFilter.addedSince = lastScanAt
    fetchShows(showFilter)
      .then((data) => { setShows(data); setListNonce(Date.now()) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  // Exclude sort, view, and genre (client-side) from reload trigger
  const filterTrigger = useMemo(() => {
    const p = new URLSearchParams(searchParams)
    p.delete('sort')
    p.delete('view')
    p.delete('genre')
    return p.toString()
  }, [searchParams])

  useEffect(() => { load() }, [filterTrigger])

  // Client-side genre filter
  const allGenres = useMemo(() => [...new Set(shows.flatMap((s) => s.genres))].sort(), [shows])

  // Client-side sort + genre filter + multi-library split
  const displayShows = useMemo<DisplayShow[]>(() => {
    let arr = filter.genre ? shows.filter((s) => s.genres.includes(filter.genre)) : [...shows]
    switch (filter.sort) {
      case 'title_desc':
        arr.sort((a, b) => b.title.localeCompare(a.title))
        break
      case 'year_desc':
        arr.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
        break
      case 'year_asc':
        arr.sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
        break
      case 'rating_desc':
        arr.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
        break
      case 'completeness_desc':
        arr.sort((a, b) => {
          const pctA = a.totalEpisodes > 0 ? a.ownedEpisodes / a.totalEpisodes : 0
          const pctB = b.totalEpisodes > 0 ? b.ownedEpisodes / b.totalEpisodes : 0
          return pctB - pctA
        })
        break
    }
    // Explode shows with multiple scan roots into separate display entries
    return arr.flatMap((show) => {
      if (show.scanRoots.length <= 1) {
        return [{ ...show, displayLibrary: show.scanRoots[0] ?? null, listKey: show.id }]
      }
      return show.scanRoots.map((root) => ({
        ...show,
        displayLibrary: root,
        listKey: `${show.id}_${root.id}`,
      }))
    })
  }, [shows, filter.sort, filter.genre])

  // Deselect items that are no longer visible after filtering
  useEffect(() => {
    const visibleKeys = new Set(displayShows.map((s) => s.listKey))
    setSelected((prev) => {
      const next = new Set([...prev].filter((k) => visibleKeys.has(k)))
      return next.size === prev.size ? prev : next
    })
  }, [displayShows])

  // Persist selection to sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem('mediaDillo.showsSelected', JSON.stringify([...selected])) } catch { /* ignore */ }
  }, [selected])

  // Persist current search to sessionStorage so ShowDetailPage back-button can restore it
  useEffect(() => {
    try { sessionStorage.setItem('mediaDillo.showsSearch', location.search) } catch { /* ignore */ }
  }, [location.search])

  // Auto-clear selectedOnly when selection empties
  useEffect(() => { if (selected.size === 0) setSelectedOnly(false) }, [selected])

  const visibleShows = useMemo(
    () => selectedOnly ? displayShows.filter((s) => selected.has(s.listKey)) : displayShows,
    [displayShows, selectedOnly, selected],
  )

  // Counts for toggle filters
  const counts = useMemo(() => ({
    missingArtwork: shows.filter((s) => !s.posterDownloaded || !s.backdropDownloaded).length,
    unmatched: shows.filter((s) => !s.tmdbId && !s.tvdbId).length,
    needsOrganizing: shows.filter((s) => !s.isOrganized).length,
    duplicates: shows.filter((s) => s.isDuplicate).length,
  }), [shows])

  const hasActiveFilter = !!(
    filter.search || filter.genre || filter.qualityTier || filter.missingArtwork ||
    filter.unmatched || filter.needsOrganizing || filter.duplicates || filter.status || filter.scanRootId
  )

  const allKeys = visibleShows.map((s) => s.listKey)
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k))
  const someSelected = selected.size > 0

  function toggleAll() { setSelected(allSelected ? new Set() : new Set(allKeys)) }

  function toggleOne(key: string, index: number, shiftKey: boolean) {
    if (shiftKey && lastSelectedIdx !== null) {
      const [from, to] = lastSelectedIdx <= index ? [lastSelectedIdx, index] : [index, lastSelectedIdx]
      setSelected((prev) => {
        const next = new Set(prev)
        visibleShows.slice(from, to + 1).forEach((s) => next.add(s.listKey))
        return next
      })
    } else {
      setSelected((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
      setLastSelectedIdx(index)
    }
  }

  // Extract unique show IDs from selected keys (deduplicate multi-library entries)
  function selectedShowIds(): string[] {
    return [...new Set([...selected].map((k) => k.split('_')[0]!))]
  }

  function clearFilters() {
    setPartial({ search: '', genre: '', qualityTier: '', missingArtwork: false, unmatched: false, needsOrganizing: false, duplicates: '', status: '', scanRootId: '' })
  }

  function handleBatchDelete() {
    const ids = selectedShowIds()
    if (ids.length === 0) return
    setConfirm({
      title: 'Remove records',
      message: `Remove ${ids.length} show record${ids.length !== 1 ? 's' : ''} from the database? Files on disk are not affected.`,
      onConfirm: async () => {
        setConfirm(null)
        const results = await Promise.allSettled(ids.map((id) => deleteShow(id)))
        const failed = results.filter((r) => r.status === 'rejected').length
        if (failed > 0) {
          toast({ type: 'error', message: `${failed} record${failed !== 1 ? 's' : ''} could not be removed` })
        } else {
          toast({ type: 'success', message: `${ids.length} record${ids.length !== 1 ? 's' : ''} removed` })
        }
        setSelected(new Set())
        load(true)
      },
    })
  }

  async function handleBatchRematch() {
    const matchedIds = selectedShowIds().filter((id) => shows.find((s) => s.id === id)?.tmdbId)
    if (matchedIds.length === 0) {
      toast({ type: 'error', message: 'No matched shows selected — rematch only works on already-matched items' })
      return
    }
    try {
      const { jobId, total } = await refreshMetadata([], matchedIds)
      trackJob({ label: `Re-matching ${total} show${total !== 1 ? 's' : ''}`, jobId, onComplete: () => load(true) })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Rematch failed' })
    }
  }

  async function handleBatchRename() {
    if (selected.size === 0) return
    try {
      const { jobId, total, message } = await renameBatchShows(selectedShowIds())
      if (!jobId) {
        toast({ type: 'success', message: message ?? 'Nothing to rename' })
        return
      }
      trackJob({ label: `Renaming ${total} show${total !== 1 ? 's' : ''}`, jobId, onComplete: () => load(true) })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Rename failed' })
    }
  }

  async function handleBatchCleanup() {
    if (selected.size === 0) return
    try {
      const { jobId, total } = await cleanupBatch([], selectedShowIds())
      trackJob({ label: `Cleaning ${total} show folder${total !== 1 ? 's' : ''}`, jobId, onComplete: () => load(true) })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Cleanup failed' })
    }
  }

  const activeScanRoot = scanRoots.find((r) => r.id === filter.scanRootId)

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">TV Shows</h1>
        <span className="text-sm text-gray-500">{loading ? '…' : `${displayShows.length} shows`}</span>
      </div>

      {/* Library tabs / scan root selector */}
      {scanRoots.length > 0 && (
        scanRoots.length > 4 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Library:</span>
            <select
              value={filter.scanRootId}
              onChange={(e) => setPartial({ scanRootId: e.target.value })}
              className="bg-surface-raised border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent"
            >
              <option value="">All</option>
              {scanRoots.map((root) => (
                <option key={root.id} value={root.id}>{root.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex gap-1 border-b border-gray-800">
            <button
              onClick={() => setPartial({ scanRootId: '' })}
              className={['px-3 py-1.5 text-sm font-medium rounded-t -mb-px border transition-colors', !filter.scanRootId ? 'bg-surface-raised text-white border-gray-700 border-b-surface-raised' : 'text-gray-400 hover:text-gray-200 border-transparent'].join(' ')}
            >
              All
            </button>
            {scanRoots.map((root) => (
              <button
                key={root.id}
                onClick={() => setPartial({ scanRootId: root.id })}
                className={['px-3 py-1.5 text-sm font-medium rounded-t -mb-px border transition-colors', filter.scanRootId === root.id ? 'bg-surface-raised text-white border-gray-700 border-b-surface-raised' : 'text-gray-400 hover:text-gray-200 border-transparent'].join(' ')}
              >
                {root.label}
              </button>
            ))}
          </div>
        )
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          ref={searchRef}
          type="search"
          placeholder="Search shows…"
          value={filter.search}
          onChange={(e) => setPartial({ search: e.target.value })}
          className="bg-surface-raised border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent w-48"
        />

        {allGenres.length > 0 && (
          <select
            value={filter.genre}
            onChange={(e) => setPartial({ genre: e.target.value })}
            className="bg-surface-raised border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent"
          >
            <option value="">All genres</option>
            {allGenres.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        )}

        <select
          value={filter.qualityTier}
          onChange={(e) => setPartial({ qualityTier: e.target.value })}
          className="bg-surface-raised border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent"
        >
          <option value="">All quality</option>
          {QUALITY_TIERS.map((q) => <option key={q} value={q}>{q}</option>)}
        </select>

        {lastScanAt && (
          <button
            onClick={() => setPartial({ newOnly: !filter.newOnly })}
            className={['text-xs px-2.5 py-1 rounded border transition-colors flex items-center gap-1.5', filter.newOnly ? 'bg-sky-500/20 border-sky-500/60 text-sky-300' : 'border-sky-800/60 text-sky-500 hover:text-sky-300'].join(' ')}
          >
            ✦ New
            <span
              role="button"
              tabIndex={0}
              title="Clear new items highlight"
              onClick={(e) => {
                e.stopPropagation()
                localStorage.removeItem('mediaDillo.lastScanAt')
                setLastScanAt(null)
                setPartial({ newOnly: false })
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); localStorage.removeItem('mediaDillo.lastScanAt'); setLastScanAt(null); setPartial({ newOnly: false }) } }}
              className="text-sky-700 hover:text-sky-400 leading-none cursor-pointer"
            >
              ×
            </span>
          </button>
        )}

        <button
          onClick={() => setPartial({ missingArtwork: !filter.missingArtwork })}
          className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.missingArtwork ? 'bg-yellow-500/20 border-yellow-500/60 text-yellow-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
        >
          Missing artwork{!filter.missingArtwork && counts.missingArtwork > 0 && <span className="ml-1 opacity-60">({counts.missingArtwork})</span>}
        </button>

        <button
          onClick={() => setPartial({ unmatched: !filter.unmatched })}
          className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.unmatched ? 'bg-red-500/20 border-red-500/60 text-red-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
        >
          Unmatched{!filter.unmatched && counts.unmatched > 0 && <span className="ml-1 opacity-60">({counts.unmatched})</span>}
        </button>

        <button
          onClick={() => setPartial({ needsOrganizing: !filter.needsOrganizing })}
          className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.needsOrganizing ? 'bg-orange-500/20 border-orange-500/60 text-orange-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
        >
          Needs organizing{!filter.needsOrganizing && counts.needsOrganizing > 0 && <span className="ml-1 opacity-60">({counts.needsOrganizing})</span>}
        </button>

        <button
          onClick={() => setPartial({ duplicates: !filter.duplicates ? 'only' : filter.duplicates === 'only' ? 'hide' : '' })}
          className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.duplicates === 'only' ? 'bg-orange-500/20 border-orange-500/60 text-orange-300' : filter.duplicates === 'hide' ? 'bg-gray-700/60 border-gray-600 text-gray-400' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
        >
          {filter.duplicates === 'only' ? 'Duplicates only' : filter.duplicates === 'hide' ? 'Hiding duplicates' : <>Duplicates{!filter.duplicates && counts.duplicates > 0 && <span className="ml-1 opacity-60">({counts.duplicates})</span>}</>}
        </button>

        <button
          onClick={() => setPartial({ status: filter.status === 'continuing' ? '' : 'continuing' })}
          className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.status === 'continuing' ? 'bg-green-500/20 border-green-500/60 text-green-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
        >
          Airing
        </button>

        <button
          onClick={() => setPartial({ status: filter.status === 'ended' ? '' : 'ended' })}
          className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.status === 'ended' ? 'bg-gray-500/20 border-gray-500/60 text-gray-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
        >
          Ended
        </button>

        {hasActiveFilter && (
          <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-200 transition-colors">
            Clear filters
          </button>
        )}

        {/* Sort + view toggle */}
        <div className="ml-auto flex items-center gap-2">
          <select
            value={filter.sort}
            onChange={(e) => setPartial({ sort: e.target.value })}
            className="bg-surface-raised border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-400 focus:outline-none focus:border-accent"
            title="Sort order"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPartial({ view: 'grid' })}
              title="Grid view"
              className={['p-1.5 rounded border transition-colors', filter.view === 'grid' ? 'bg-accent/20 border-accent/40 text-accent' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
            >
              <GridIcon />
            </button>
            <button
              onClick={() => setPartial({ view: 'list' })}
              title="List view"
              className={['p-1.5 rounded border transition-colors', filter.view === 'list' ? 'bg-accent/20 border-accent/40 text-accent' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
            >
              <ListIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Active filter chips */}
      {hasActiveFilter && (
        <div className="flex flex-wrap gap-1.5">
          {filter.search && <FilterChip label={`"${filter.search}"`} onRemove={() => setPartial({ search: '' })} />}
          {filter.genre && <FilterChip label={`Genre: ${filter.genre}`} onRemove={() => setPartial({ genre: '' })} />}
          {filter.qualityTier && <FilterChip label={`Quality: ${filter.qualityTier}`} onRemove={() => setPartial({ qualityTier: '' })} />}
          {filter.missingArtwork && <FilterChip label="Missing artwork" onRemove={() => setPartial({ missingArtwork: false })} />}
          {filter.unmatched && <FilterChip label="Unmatched" onRemove={() => setPartial({ unmatched: false })} />}
          {filter.needsOrganizing && <FilterChip label="Needs organizing" onRemove={() => setPartial({ needsOrganizing: false })} />}
          {filter.duplicates === 'only' && <FilterChip label="Duplicates only" onRemove={() => setPartial({ duplicates: '' })} />}
          {filter.duplicates === 'hide' && <FilterChip label="Hiding duplicates" onRemove={() => setPartial({ duplicates: '' })} />}
          {filter.status === 'continuing' && <FilterChip label="Airing" onRemove={() => setPartial({ status: '' })} />}
          {filter.status === 'ended' && <FilterChip label="Ended" onRemove={() => setPartial({ status: '' })} />}
          {activeScanRoot && <FilterChip label={`Library: ${activeScanRoot.label}`} onRemove={() => setPartial({ scanRootId: '' })} />}
        </div>
      )}

      {loading && filter.view === 'grid' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {Array.from({ length: 20 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      )}
      {loading && filter.view === 'list' && (
        <div className="bg-surface-raised border border-gray-800 rounded-lg divide-y divide-gray-800">
          {Array.from({ length: 10 }, (_, i) => <SkeletonRow key={i} />)}
        </div>
      )}
      {!loading && error && <div className="text-red-400 py-8 text-center text-sm">{error}</div>}
      {!loading && !error && displayShows.length === 0 && (
        <div className="py-20 text-center space-y-2">
          <p className="text-gray-400 text-sm">No shows found.</p>
          {hasActiveFilter && (
            <button onClick={clearFilters} className="text-xs text-accent hover:underline">
              Clear all filters
            </button>
          )}
        </div>
      )}

      {!loading && !error && displayShows.length > 0 && filter.view === 'grid' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {displayShows.map((show) => (
            <ShowCard key={show.listKey} show={show} nonce={listNonce} isNew={!!lastScanAt && new Date(show.createdAt) >= new Date(lastScanAt)} listSearch={location.search} />
          ))}
        </div>
      )}

      {!loading && !error && displayShows.length > 0 && filter.view === 'list' && (
        <div className="bg-surface-raised border border-gray-800 rounded-lg divide-y divide-gray-800">
          <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-700">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
              onChange={toggleAll}
              className="accent-accent cursor-pointer"
            />
            <span className="text-xs text-gray-500">
              {someSelected ? `${selected.size} selected` : `${visibleShows.length} items`}
            </span>
          </div>
          {visibleShows.map((show, idx) => (
            <ShowListRow
              key={show.listKey}
              show={show}
              selected={selected.has(show.listKey)}
              index={idx}
              nonce={listNonce}
              isNew={!!lastScanAt && new Date(show.createdAt) >= new Date(lastScanAt)}
              listSearch={location.search}
              onToggle={(e) => toggleOne(show.listKey, idx, e.shiftKey)}
            />
          ))}
        </div>
      )}

      {/* Batch action bar */}
      {filter.view === 'list' && someSelected && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-gray-900 border border-gray-700 rounded-xl px-5 py-3 shadow-2xl">
          <span className="text-sm text-gray-300 font-medium">{selected.size} selected</span>
          <button
            onClick={() => setSelectedOnly((v) => !v)}
            className={['text-xs px-2.5 py-1 rounded border transition-colors', selectedOnly ? 'bg-accent/20 border-accent/40 text-accent' : 'border-gray-600 text-gray-400 hover:text-gray-200'].join(' ')}
          >
            Only show selected
          </button>
          <div className="w-px h-4 bg-gray-700" />
          <button
            onClick={() => { void handleBatchRematch() }}
            className="text-xs px-3 py-1.5 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 transition-colors"
          >
            Rematch
          </button>
          <button
            onClick={() => { void handleBatchRename() }}
            className="text-xs px-3 py-1.5 rounded bg-blue-700/20 border border-blue-700/40 text-blue-400 hover:bg-blue-700/30 transition-colors"
          >
            Rename
          </button>
          <button
            onClick={() => { void handleBatchCleanup() }}
            className="text-xs px-3 py-1.5 rounded bg-gray-700/40 border border-gray-600/60 text-gray-300 hover:bg-gray-700/60 transition-colors"
          >
            Cleanup
          </button>
          <button
            onClick={handleBatchDelete}
            className="text-xs px-3 py-1.5 rounded bg-red-700/20 border border-red-700/40 text-red-400 hover:bg-red-700/30 transition-colors"
          >
            Remove records
          </button>
          <button
            onClick={() => { setSelected(new Set()); setSelectedOnly(false) }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Deselect
          </button>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          key={[...selected].join(',')}
          title={confirm.title}
          message={confirm.message}
          confirmLabel="Remove"
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

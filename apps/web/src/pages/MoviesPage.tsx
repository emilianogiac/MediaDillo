import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams, useLocation } from 'react-router-dom'
import type { MovieSummary, ScanRoot } from '../api/types.js'
import { fetchMovies, fetchScanRoots, fetchEditions, triggerMovieDownload, deleteMovie } from '../api/movies.js'
import { refreshMetadata, cleanupBatch } from '../api/library-health.js'
import { renameBatch } from '../api/files.js'
import { PosterCard } from '../components/PosterCard.js'
import { TechBadge } from '../components/TechBadge.js'
import { BatchRenameModal } from '../components/BatchRenameModal.js'
import { SkeletonCard, SkeletonRow } from '../components/SkeletonCard.js'
import { useToast } from '../context/ToastContext.js'
import { ConfirmModal } from '../components/ConfirmModal.js'

const QUALITY_TIERS = ['360p', '480p', '576p', '720p', '1080p', '1440p', '4K']
const QUALITY_RANK: Record<string, number> = { '4K': 6, '1440p': 5, '1080p': 4, '720p': 3, '576p': 2, '480p': 1, '360p': 0 }

const SORT_OPTIONS = [
  { value: 'title_asc', label: 'Title A–Z' },
  { value: 'title_desc', label: 'Title Z–A' },
  { value: 'year_desc', label: 'Newest' },
  { value: 'year_asc', label: 'Oldest' },
  { value: 'rating_desc', label: 'Highest rated' },
  { value: 'quality_desc', label: 'Best quality' },
]

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

interface ListRowProps {
  movie: MovieSummary
  selected: boolean
  index: number
  nonce: number
  isNew: boolean
  listSearch: string
  onToggle: (e: React.MouseEvent<HTMLInputElement>) => void
}

function MovieListRow({ movie, selected, index, nonce, isNew, listSearch, onToggle }: ListRowProps) {
  const file = movie.files[0]
  const qualityTier = file?.videoQualityTier
  const videoCodec = file?.videoCodec
  const audioLabel = [file?.audioCodec, file?.audioChannels].filter(Boolean).join(' ')
  const unmatched = !movie.tmdbId
  const isDuplicate = movie.duplicateCount > 1
  const missingFile = movie.files.length === 0
  const rowBg = index % 2 === 1 ? 'bg-gray-900/30' : ''

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
        to={`/movies/${movie.id}`}
        state={{ from: listSearch }}
        className="flex flex-1 items-center gap-3 px-3 py-2 hover:bg-gray-800/40 transition-colors min-w-0"
      >
        <div className="w-8 h-12 flex-shrink-0 rounded overflow-hidden bg-gray-800">
          {(movie.posterDownloaded || movie.posterUrl) ? (
            <img
              src={movie.posterDownloaded ? `/api/artwork/movies/${movie.id}/poster?v=${nonce}` : movie.posterUrl!}
              alt={movie.title}
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gray-700" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-100">{movie.title}</p>
          <p className="text-xs text-gray-500">{movie.year ?? '—'}</p>
        </div>

        <div className="flex-shrink-0 w-14">
          {qualityTier && <TechBadge label={qualityTier} variant="quality" />}
        </div>

        <div className="flex-shrink-0 w-12 text-xs text-gray-500 tabular-nums truncate">
          {videoCodec ?? '—'}
        </div>

        <div className="flex-shrink-0 w-24 text-xs text-gray-500 tabular-nums truncate">
          {audioLabel || '—'}
        </div>

        <div className={`flex-shrink-0 w-8 text-xs text-right tabular-nums ${movie.fileCount > 1 ? 'text-yellow-400 font-medium' : 'text-gray-600'}`}>
          {movie.fileCount > 0 ? `${movie.fileCount}f` : '—'}
        </div>

        <div className="flex-shrink-0 w-28 text-xs text-gray-500 truncate text-right">
          {movie.scanRoot?.label ?? '—'}
        </div>

        <div className="flex-shrink-0 w-28 flex gap-1 items-center">
          {isNew && (
            <span className="bg-sky-500/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">New</span>
          )}
          {missingFile && (
            <span className="bg-red-700/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">Missing</span>
          )}
          {!missingFile && unmatched && (
            <span className="bg-red-600/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">Unmatched</span>
          )}
          {isDuplicate && (
            <span className="bg-orange-500/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">{movie.duplicateCount}×</span>
          )}
          {movie.isOrganized && (
            <span className="bg-green-600/90 text-white text-xs px-1 py-0.5 rounded font-medium">✓</span>
          )}
        </div>
      </Link>
    </div>
  )
}

export function MoviesPage() {
  const { toast, trackJob } = useToast()
  const location = useLocation()
  const [movies, setMovies] = useState<MovieSummary[]>([])
  const [scanRoots, setScanRoots] = useState<ScanRoot[]>([])
  const [editionLabels, setEditionLabels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [listNonce, setListNonce] = useState(() => Date.now())
  const [showShortcuts, setShowShortcuts] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null)
  const [selectedOnly, setSelectedOnly] = useState(false)

  const [batchQueue, setBatchQueue] = useState<string[]>([])
  const [batchAction, setBatchAction] = useState<'rename' | null>(null)
  const [batchIdx, setBatchIdx] = useState(0)
  const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

  const [lastScanAt, setLastScanAt] = useState<string | null>(() => localStorage.getItem('mediaDillo.lastScanAt'))

  const rawDuplicates = searchParams.get('duplicates')
  const filter = {
    scanRootId: searchParams.get('root') ?? '',
    search: searchParams.get('q') ?? '',
    genre: searchParams.get('genre') ?? '',
    qualityTier: searchParams.get('quality') ?? '',
    missingArtwork: searchParams.has('missing'),
    unmatched: searchParams.has('unmatched'),
    missingFile: searchParams.has('missingfile'),
    needsRename: searchParams.has('needsrename'),
    needsOrganizing: searchParams.has('unorganized'),
    duplicates: (rawDuplicates === 'only' || rawDuplicates === 'hide') ? rawDuplicates as 'only' | 'hide' : undefined,
    edition: searchParams.get('edition') ?? '',
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
    missingFile?: boolean
    needsRename?: boolean
    needsOrganizing?: boolean
    duplicates?: 'only' | 'hide' | ''
    edition?: string
    newOnly?: boolean
    view?: 'grid' | 'list'
    sort?: string
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
        if ('missingFile' in partial) {
          partial.missingFile ? next.set('missingfile', '1') : next.delete('missingfile')
        }
        if ('needsRename' in partial) {
          partial.needsRename ? next.set('needsrename', '1') : next.delete('needsrename')
        }
        if ('needsOrganizing' in partial) {
          partial.needsOrganizing ? next.set('unorganized', '1') : next.delete('unorganized')
        }
        if ('duplicates' in partial) {
          partial.duplicates ? next.set('duplicates', partial.duplicates) : next.delete('duplicates')
        }
        if ('edition' in partial) {
          partial.edition ? next.set('edition', partial.edition) : next.delete('edition')
        }
        if ('newOnly' in partial) {
          partial.newOnly ? next.set('new', '1') : next.delete('new')
        }
        if ('view' in partial) {
          partial.view === 'list' ? next.set('view', 'list') : next.delete('view')
        }
        if ('sort' in partial) {
          partial.sort && partial.sort !== 'title_asc' ? next.set('sort', partial.sort) : next.delete('sort')
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
    fetchEditions().then(setEditionLabels).catch(() => {})
  }, [])

  function load(silent = false) {
    if (!silent) setLoading(true)
    setError(null)
    const movieFilter: import('../api/movies.js').MoviesFilter = {}
    if (filter.scanRootId) movieFilter.scanRootId = filter.scanRootId
    if (filter.search) movieFilter.search = filter.search
    if (filter.genre) movieFilter.genre = filter.genre
    if (filter.qualityTier) movieFilter.qualityTier = filter.qualityTier
    if (filter.missingArtwork) movieFilter.missingArtwork = true
    if (filter.unmatched) movieFilter.unmatched = true
    if (filter.missingFile) movieFilter.missingFile = true
    if (filter.needsRename) movieFilter.needsRename = true
    if (filter.needsOrganizing) movieFilter.organized = false
    if (filter.duplicates) movieFilter.duplicates = filter.duplicates
    if (filter.edition) movieFilter.edition = filter.edition
    if (filter.newOnly && lastScanAt) movieFilter.addedSince = lastScanAt
    fetchMovies(movieFilter)
      .then((data) => { setMovies(data); setListNonce(Date.now()) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  // Exclude sort and view from the reload trigger — they don't affect server results
  const filterTrigger = useMemo(() => {
    const p = new URLSearchParams(searchParams)
    p.delete('sort')
    p.delete('view')
    return p.toString()
  }, [searchParams])

  useEffect(() => { load() }, [filterTrigger])

  // Client-side sort
  const sortedMovies = useMemo(() => {
    const arr = [...movies]
    switch (filter.sort) {
      case 'title_desc':
        return arr.sort((a, b) => a.title.localeCompare(b.title) * -1)
      case 'year_desc':
        return arr.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
      case 'year_asc':
        return arr.sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
      case 'rating_desc':
        return arr.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      case 'quality_desc':
        return arr.sort((a, b) => (QUALITY_RANK[b.files[0]?.videoQualityTier ?? ''] ?? -1) - (QUALITY_RANK[a.files[0]?.videoQualityTier ?? ''] ?? -1))
      default:
        return arr // title_asc: already sorted by server
    }
  }, [movies, filter.sort])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'

      if (e.key === 'Escape') {
        if (showShortcuts) { setShowShortcuts(false); return }
        if (inField) { (e.target as HTMLElement).blur(); return }
        return
      }
      if (inField) return

      if (e.key === '?') { setShowShortcuts((v) => !v); return }
      if (e.key === 'g') { setPartial({ view: 'grid' }); return }
      if (e.key === 'l') { setPartial({ view: 'list' }); return }
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showShortcuts])

  async function handleArtworkDownload(movieId: string) {
    try {
      await triggerMovieDownload(movieId, 'all')
      toast({ type: 'success', message: 'Artwork downloaded' })
      setListNonce(Date.now())
    } catch {
      toast({ type: 'error', message: 'Failed to download artwork' })
    }
  }

  const allGenres = useMemo(
    () => [...new Set(movies.flatMap((m) => m.genres))].sort(),
    [movies],
  )

  // Counts for toggle filters — from current result set so user sees "within this view, N also match"
  const counts = useMemo(() => ({
    missingArtwork: movies.filter((m) => !m.posterDownloaded || !m.backdropDownloaded).length,
    unmatched: movies.filter((m) => !m.tmdbId).length,
    missingFile: movies.filter((m) => m.files.length === 0).length,
    needsOrganizing: movies.filter((m) => !m.isOrganized).length,
    duplicates: movies.filter((m) => m.isDuplicate).length,
  }), [movies])

  const hasActiveFilter =
    filter.search || filter.genre || filter.qualityTier || filter.missingArtwork || filter.unmatched || filter.missingFile || filter.needsRename || filter.needsOrganizing || filter.duplicates || filter.edition

  const visibleMovies = useMemo(
    () => selectedOnly ? sortedMovies.filter((m) => selected.has(m.id)) : sortedMovies,
    [sortedMovies, selectedOnly, selected],
  )

  const allIds = visibleMovies.map((m) => m.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const someSelected = selected.size > 0

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds))
  }

  function toggleOne(id: string, index: number, shiftKey: boolean) {
    if (shiftKey && lastSelectedIdx !== null) {
      const [from, to] = lastSelectedIdx <= index ? [lastSelectedIdx, index] : [index, lastSelectedIdx]
      setSelected((prev) => {
        const next = new Set(prev)
        visibleMovies.slice(from, to + 1).forEach((m) => next.add(m.id))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      })
      setLastSelectedIdx(index)
    }
  }

  async function handleBatchRematch() {
    const matchedIds = [...selected].filter((id) => sortedMovies.find((m) => m.id === id)?.tmdbId)
    if (matchedIds.length === 0) {
      toast({ type: 'error', message: 'No matched movies selected — rematch only works on already-matched items' })
      return
    }
    try {
      const { jobId, total } = await refreshMetadata(matchedIds, [])
      trackJob({ label: `Re-matching ${total} movie${total !== 1 ? 's' : ''}`, jobId, onComplete: () => load(true) })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Rematch failed' })
    }
  }

  function handleBatchDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    setConfirm({
      title: 'Remove records',
      message: `Remove ${ids.length} movie record${ids.length !== 1 ? 's' : ''} from the database? Files on disk are not affected.`,
      onConfirm: async () => {
        setConfirm(null)
        const results = await Promise.allSettled(ids.map((id) => deleteMovie(id)))
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

  async function handleBatchCleanup() {
    const ids = [...selected]
    if (ids.length === 0) return
    try {
      const { jobId, total } = await cleanupBatch(ids)
      trackJob({ label: `Cleaning ${total} folder${total !== 1 ? 's' : ''}`, jobId, onComplete: () => load(true) })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Cleanup failed' })
    }
  }

  async function handleBatchRenameAll() {
    if (selected.size === 0) return
    try {
      const { jobId, total, message } = await renameBatch([...selected])
      if (!jobId) {
        toast({ type: 'success', message: message ?? 'Nothing to rename' })
        return
      }
      trackJob({ label: `Renaming ${total} movie${total !== 1 ? 's' : ''}`, jobId, onComplete: () => load(true) })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Rename failed' })
    }
  }

  async function handleBatchArtworkDownload() {
    const ids = [...selected].filter((id) => {
      const m = sortedMovies.find((mv) => mv.id === id)
      return m && (!m.posterDownloaded || !m.backdropDownloaded)
    })
    if (ids.length === 0) {
      toast({ type: 'error', message: 'All selected movies already have artwork' })
      return
    }
    try {
      await Promise.all(ids.map((id) => triggerMovieDownload(id, 'all')))
      toast({ type: 'success', message: `Downloading artwork for ${ids.length} movie${ids.length !== 1 ? 's' : ''}` })
      load(true)
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Artwork download failed' })
    }
  }

  async function handleBatchApplyAll() {
    const remainingIds = batchQueue.slice(batchIdx + 1)
    if (remainingIds.length > 0) {
      try {
        const { jobId, total } = await renameBatch(remainingIds)
        if (jobId) {
          trackJob({ label: `Renaming ${total} movie${total !== 1 ? 's' : ''}`, jobId, onComplete: () => load(true) })
        }
      } catch (e) {
        toast({ type: 'error', message: e instanceof Error ? e.message : 'Rename failed' })
      }
    }
    cancelBatch()
  }

  function startBatch(action: 'rename') {
    const queue = [...selected]
    if (queue.length === 0) return
    setBatchQueue(queue)
    setBatchAction(action)
    setBatchIdx(0)
  }

  function advanceBatch() {
    if (batchIdx + 1 >= batchQueue.length) {
      setBatchAction(null)
      setBatchQueue([])
      setBatchIdx(0)
      load(true)
    } else {
      setBatchIdx((i) => i + 1)
    }
  }

  // Auto-clear selectedOnly when selection empties
  useEffect(() => { if (selected.size === 0) setSelectedOnly(false) }, [selected])

  function cancelBatch() {
    setBatchAction(null)
    setBatchQueue([])
    setBatchIdx(0)
    load(true)
  }

  function getEmptyMessage() {
    if (filter.search) return `No movies matching "${filter.search}"`
    if (filter.missingArtwork) return 'No movies with missing artwork — library looks great!'
    if (filter.unmatched) return 'No unmatched movies — all titles are matched!'
    if (filter.missingFile) return 'No stale records found!'
    if (filter.needsRename) return 'All filenames are canonical!'
    if (filter.needsOrganizing) return 'All movies are organized!'
    if (filter.duplicates === 'only') return 'No duplicate movies found!'
    if (filter.genre) return `No movies in the "${filter.genre}" genre`
    if (filter.qualityTier) return `No movies at ${filter.qualityTier}`
    if (filter.edition) return `No movies with edition "${filter.edition}"`
    return 'No movies found.'
  }

  const currentBatchId = batchAction ? batchQueue[batchIdx] : null
  const currentBatchMovie = currentBatchId ? sortedMovies.find((m) => m.id === currentBatchId) ?? null : null

  const activeScanRoot = scanRoots.find((r) => r.id === filter.scanRootId)

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Movies</h1>
        <span className="text-sm text-gray-500">{loading ? '…' : `${movies.length} titles`}</span>
      </div>

      {/* Category tabs / scan root selector */}
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
        )
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          ref={searchRef}
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
            <option key={g} value={g}>{g}</option>
          ))}
        </select>

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
          onClick={() => setPartial({ missingFile: !filter.missingFile })}
          className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.missingFile ? 'bg-red-700/20 border-red-700/60 text-red-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
        >
          Missing file{!filter.missingFile && counts.missingFile > 0 && <span className="ml-1 opacity-60">({counts.missingFile})</span>}
        </button>

        <button
          onClick={() => setPartial({ needsRename: !filter.needsRename })}
          className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.needsRename ? 'bg-orange-500/20 border-orange-500/60 text-orange-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
        >
          Needs rename
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

        {editionLabels.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {editionLabels.map((label) => (
              <button
                key={label}
                onClick={() => setPartial({ edition: filter.edition === label ? '' : label })}
                className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.edition === label ? 'bg-teal-500/20 border-teal-500/60 text-teal-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {hasActiveFilter && (
          <button
            onClick={() => setPartial({ search: '', genre: '', qualityTier: '', missingArtwork: false, unmatched: false, missingFile: false, needsRename: false, needsOrganizing: false, duplicates: '', edition: '' })}
            className="text-xs text-gray-500 hover:text-gray-200 transition-colors"
          >
            Clear filters
          </button>
        )}

        {/* Sort + view toggle — right-aligned */}
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
              title="Grid view (g)"
              className={['p-1.5 rounded border transition-colors', filter.view === 'grid' ? 'bg-accent/20 border-accent/40 text-accent' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
            >
              <GridIcon />
            </button>
            <button
              onClick={() => setPartial({ view: 'list' })}
              title="List view (l)"
              className={['p-1.5 rounded border transition-colors', filter.view === 'list' ? 'bg-accent/20 border-accent/40 text-accent' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
            >
              <ListIcon />
            </button>
          </div>

          <button
            onClick={() => setShowShortcuts(true)}
            title="Keyboard shortcuts (?)"
            className="p-1.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 transition-colors text-xs font-mono leading-none"
          >
            ?
          </button>
        </div>
      </div>

      {/* Active filter chips */}
      {hasActiveFilter && (
        <div className="flex flex-wrap gap-1.5">
          {filter.search && (
            <FilterChip label={`"${filter.search}"`} onRemove={() => setPartial({ search: '' })} />
          )}
          {filter.genre && (
            <FilterChip label={`Genre: ${filter.genre}`} onRemove={() => setPartial({ genre: '' })} />
          )}
          {filter.qualityTier && (
            <FilterChip label={`Quality: ${filter.qualityTier}`} onRemove={() => setPartial({ qualityTier: '' })} />
          )}
          {filter.missingArtwork && (
            <FilterChip label="Missing artwork" onRemove={() => setPartial({ missingArtwork: false })} />
          )}
          {filter.unmatched && (
            <FilterChip label="Unmatched" onRemove={() => setPartial({ unmatched: false })} />
          )}
          {filter.missingFile && (
            <FilterChip label="Missing file" onRemove={() => setPartial({ missingFile: false })} />
          )}
          {filter.needsRename && (
            <FilterChip label="Needs rename" onRemove={() => setPartial({ needsRename: false })} />
          )}
          {filter.needsOrganizing && (
            <FilterChip label="Needs organizing" onRemove={() => setPartial({ needsOrganizing: false })} />
          )}
          {filter.duplicates === 'only' && (
            <FilterChip label="Duplicates only" onRemove={() => setPartial({ duplicates: '' })} />
          )}
          {filter.duplicates === 'hide' && (
            <FilterChip label="Hiding duplicates" onRemove={() => setPartial({ duplicates: '' })} />
          )}
          {filter.edition && (
            <FilterChip label={`Edition: ${filter.edition}`} onRemove={() => setPartial({ edition: '' })} />
          )}
          {activeScanRoot && (
            <FilterChip label={`Library: ${activeScanRoot.label}`} onRemove={() => setPartial({ scanRootId: '' })} />
          )}
        </div>
      )}

      {/* Content */}
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
      {!loading && !error && sortedMovies.length === 0 && (
        <div className="py-20 text-center space-y-2">
          <p className="text-gray-400 text-sm">{getEmptyMessage()}</p>
          {hasActiveFilter && (
            <button
              onClick={() => setPartial({ search: '', genre: '', qualityTier: '', missingArtwork: false, unmatched: false, missingFile: false, needsRename: false, needsOrganizing: false, duplicates: '', edition: '' })}
              className="text-xs text-accent hover:underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {!loading && !error && sortedMovies.length > 0 && filter.view === 'grid' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {sortedMovies.map((movie) => {
            const needsArt = !movie.posterDownloaded || !movie.backdropDownloaded
            const isNew = lastScanAt ? new Date(movie.createdAt) >= new Date(lastScanAt) : false
            return (
              <PosterCard
                key={movie.id}
                movie={movie}
                version={listNonce}
                isNew={isNew}
                listSearch={location.search}
                {...(needsArt ? { onArtworkDownload: () => { void handleArtworkDownload(movie.id) } } : {})}
              />
            )
          })}
        </div>
      )}

      {!loading && !error && sortedMovies.length > 0 && filter.view === 'list' && (
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
              {someSelected ? `${selected.size} selected` : `${visibleMovies.length} items`}
            </span>
          </div>

          {visibleMovies.map((movie, idx) => {
            const isNew = lastScanAt ? new Date(movie.createdAt) >= new Date(lastScanAt) : false
            return (
              <MovieListRow
                key={movie.id}
                movie={movie}
                selected={selected.has(movie.id)}
                index={idx}
                nonce={listNonce}
                isNew={isNew}
                listSearch={location.search}
                onToggle={(e) => toggleOne(movie.id, idx, e.shiftKey)}
              />
            )
          })}
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
            onClick={() => { void handleBatchArtworkDownload() }}
            className="text-xs px-3 py-1.5 rounded bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/30 transition-colors"
          >
            Download Art
          </button>
          <button
            onClick={() => startBatch('rename')}
            className="text-xs px-3 py-1.5 rounded bg-orange-500/20 border border-orange-500/40 text-orange-300 hover:bg-orange-500/30 transition-colors"
          >
            Rename
          </button>
          <button
            onClick={() => { void handleBatchRenameAll() }}
            className="text-xs px-3 py-1.5 rounded bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-orange-500/20 transition-colors"
          >
            Rename All
          </button>
          <button
            onClick={() => { void handleBatchCleanup() }}
            className="text-xs px-3 py-1.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition-colors"
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
          title={confirm.title}
          message={confirm.message}
          confirmLabel="Remove"
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Batch rename modal */}
      {batchAction === 'rename' && currentBatchMovie && (
        <BatchRenameModal
          key={currentBatchMovie.id}
          movie={currentBatchMovie}
          remaining={batchQueue.length - batchIdx}
          onApplied={advanceBatch}
          onSkip={advanceBatch}
          onCancel={cancelBatch}
          {...(batchQueue.length - batchIdx > 1 ? { onApplyAll: handleBatchApplyAll } : {})}
        />
      )}

      {/* Keyboard shortcuts overlay */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-72 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-100 mb-4">Keyboard shortcuts</h3>
            <table className="w-full text-xs text-gray-400 border-separate border-spacing-y-2">
              <tbody>
                {[
                  ['/​', 'Focus search'],
                  ['g', 'Grid view'],
                  ['l', 'List view'],
                  ['?', 'Toggle this help'],
                  ['Esc', 'Blur / close'],
                ].map(([key, desc]) => (
                  <tr key={key}>
                    <td className="pr-4 w-12">
                      <kbd className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 font-mono text-gray-300">{key}</kbd>
                    </td>
                    <td className="text-gray-400">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={() => setShowShortcuts(false)}
              className="mt-4 text-xs text-gray-500 hover:text-gray-300 w-full text-center"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

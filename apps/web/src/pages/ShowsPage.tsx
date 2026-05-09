import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ShowSummary } from '../api/types.js'
import { fetchShows } from '../api/shows.js'
import { refreshMetadata } from '../api/library-health.js'
import { SkeletonCard, SkeletonRow } from '../components/SkeletonCard.js'
import { useToast } from '../context/ToastContext.js'

const QUALITY_TIERS = ['360p', '480p', '576p', '720p', '1080p', '1440p', '4K']

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

function ShowCard({ show, nonce, isNew }: { show: ShowSummary; nonce: number; isNew: boolean }) {
  const unmatched = !show.tmdbId
  const missingArt = !show.posterDownloaded || !show.backdropDownloaded
  const isDuplicate = show.duplicateCount > 1
  const pct = show.totalEpisodes > 0 ? Math.round((show.ownedEpisodes / show.totalEpisodes) * 100) : null

  return (
    <Link
      to={`/shows/${show.id}`}
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
        <p className="text-xs text-gray-500">{show.year ?? '—'}</p>
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
  show: ShowSummary
  selected: boolean
  index: number
  nonce: number
  isNew: boolean
  onToggle: (e: React.MouseEvent<HTMLInputElement>) => void
}

function ShowListRow({ show, selected, index, nonce, isNew, onToggle }: ListRowProps) {
  const unmatched = !show.tmdbId
  const isDuplicate = show.duplicateCount > 1
  const pct = show.totalEpisodes > 0 ? Math.round((show.ownedEpisodes / show.totalEpisodes) * 100) : null
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
        to={`/shows/${show.id}`}
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
          <p className="text-xs text-gray-500">{show.year ?? '—'}</p>
        </div>

        {/* Completeness bar — always rendered to keep columns aligned */}
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

        {/* Status chips — fixed width so all rows align */}
        <div className="flex-shrink-0 w-28 flex gap-1 items-center">
          {isNew && <span className="bg-sky-500/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">New</span>}
          {unmatched && <span className="bg-red-600/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">Unmatched</span>}
          {isDuplicate && <span className="bg-orange-500/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">{show.duplicateCount}×</span>}
          {show.isOrganized && <span className="bg-green-600/90 text-white text-xs px-1 py-0.5 rounded font-medium">✓</span>}
        </div>
      </Link>
    </div>
  )
}

export function ShowsPage() {
  const { toast, trackJob } = useToast()
  const [shows, setShows] = useState<ShowSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [listNonce, setListNonce] = useState(() => Date.now())

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null)

  const [lastScanAt, setLastScanAt] = useState<string | null>(() => localStorage.getItem('mediaDillo.lastScanAt'))

  const rawDuplicates = searchParams.get('duplicates')
  const filter = {
    search: searchParams.get('q') ?? '',
    qualityTier: searchParams.get('quality') ?? '',
    missingArtwork: searchParams.has('missing'),
    unmatched: searchParams.has('unmatched'),
    needsOrganizing: searchParams.has('unorganized'),
    duplicates: (rawDuplicates === 'only' || rawDuplicates === 'hide') ? rawDuplicates as 'only' | 'hide' : undefined,
    newOnly: searchParams.has('new'),
    view: searchParams.get('view') === 'list' ? 'list' as const : 'grid' as const,
  }

  function setPartial(partial: {
    search?: string
    qualityTier?: string
    missingArtwork?: boolean
    unmatched?: boolean
    needsOrganizing?: boolean
    duplicates?: 'only' | 'hide' | ''
    newOnly?: boolean
    view?: 'grid' | 'list'
  }) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if ('search' in partial) { partial.search ? next.set('q', partial.search) : next.delete('q') }
        if ('qualityTier' in partial) { partial.qualityTier ? next.set('quality', partial.qualityTier) : next.delete('quality') }
        if ('missingArtwork' in partial) { partial.missingArtwork ? next.set('missing', '1') : next.delete('missing') }
        if ('unmatched' in partial) { partial.unmatched ? next.set('unmatched', '1') : next.delete('unmatched') }
        if ('needsOrganizing' in partial) { partial.needsOrganizing ? next.set('unorganized', '1') : next.delete('unorganized') }
        if ('duplicates' in partial) { partial.duplicates ? next.set('duplicates', partial.duplicates) : next.delete('duplicates') }
        if ('newOnly' in partial) { partial.newOnly ? next.set('new', '1') : next.delete('new') }
        if ('view' in partial) { partial.view === 'list' ? next.set('view', 'list') : next.delete('view') }
        return next
      },
      { replace: true },
    )
  }

  function load() {
    setLoading(true)
    setError(null)
    const showFilter: import('../api/shows.js').ShowsFilter = {}
    if (filter.search) showFilter.search = filter.search
    if (filter.qualityTier) showFilter.qualityTier = filter.qualityTier
    if (filter.missingArtwork) showFilter.missingArtwork = true
    if (filter.unmatched) showFilter.unmatched = true
    if (filter.needsOrganizing) showFilter.organized = false
    if (filter.duplicates) showFilter.duplicates = filter.duplicates
    if (filter.newOnly && lastScanAt) showFilter.addedSince = lastScanAt
    fetchShows(showFilter)
      .then((data) => { setShows(data); setListNonce(Date.now()) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [searchParams.toString()])

  const hasActiveFilter = filter.search || filter.qualityTier || filter.missingArtwork || filter.unmatched || filter.needsOrganizing || filter.duplicates

  const allIds = shows.map((s) => s.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const someSelected = selected.size > 0

  function toggleAll() { setSelected(allSelected ? new Set() : new Set(allIds)) }

  function toggleOne(id: string, index: number, shiftKey: boolean) {
    if (shiftKey && lastSelectedIdx !== null) {
      const [from, to] = lastSelectedIdx <= index ? [lastSelectedIdx, index] : [index, lastSelectedIdx]
      setSelected((prev) => {
        const next = new Set(prev)
        shows.slice(from, to + 1).forEach((s) => next.add(s.id))
        return next
      })
    } else {
      setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
      setLastSelectedIdx(index)
    }
  }

  async function handleBatchRematch() {
    const matchedIds = [...selected].filter((id) => shows.find((s) => s.id === id)?.tmdbId)
    if (matchedIds.length === 0) {
      toast({ type: 'error', message: 'No matched shows selected — rematch only works on already-matched items' })
      return
    }
    try {
      const { jobId, total } = await refreshMetadata([], matchedIds)
      trackJob({ label: `Re-matching ${total} show${total !== 1 ? 's' : ''}`, jobId })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Rematch failed' })
    }
  }

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
          {QUALITY_TIERS.map((q) => <option key={q} value={q}>{q}</option>)}
        </select>

        <button
          onClick={() => setPartial({ missingArtwork: !filter.missingArtwork })}
          className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.missingArtwork ? 'bg-yellow-500/20 border-yellow-500/60 text-yellow-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
        >
          Missing artwork
        </button>

        <button
          onClick={() => setPartial({ unmatched: !filter.unmatched })}
          className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.unmatched ? 'bg-red-500/20 border-red-500/60 text-red-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
        >
          Unmatched
        </button>

        <button
          onClick={() => setPartial({ needsOrganizing: !filter.needsOrganizing })}
          className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.needsOrganizing ? 'bg-orange-500/20 border-orange-500/60 text-orange-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
        >
          Needs organizing
        </button>

        <button
          onClick={() => setPartial({ duplicates: !filter.duplicates ? 'only' : filter.duplicates === 'only' ? 'hide' : '' })}
          className={['text-xs px-2.5 py-1 rounded border transition-colors', filter.duplicates === 'only' ? 'bg-orange-500/20 border-orange-500/60 text-orange-300' : filter.duplicates === 'hide' ? 'bg-gray-700/60 border-gray-600 text-gray-400' : 'border-gray-700 text-gray-500 hover:text-gray-300'].join(' ')}
        >
          {filter.duplicates === 'only' ? 'Duplicates only' : filter.duplicates === 'hide' ? 'Hiding duplicates' : 'Duplicates'}
        </button>

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

        {hasActiveFilter && (
          <button
            onClick={() => setPartial({ search: '', qualityTier: '', missingArtwork: false, unmatched: false, needsOrganizing: false, duplicates: '' })}
            className="text-xs text-gray-500 hover:text-gray-200 transition-colors"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
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
      {!loading && !error && shows.length === 0 && <div className="text-gray-500 py-16 text-center text-sm">No shows found.</div>}

      {!loading && !error && shows.length > 0 && filter.view === 'grid' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {shows.map((show) => <ShowCard key={show.id} show={show} nonce={listNonce} isNew={!!lastScanAt && new Date(show.createdAt) >= new Date(lastScanAt)} />)}
        </div>
      )}

      {!loading && !error && shows.length > 0 && filter.view === 'list' && (
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
              {someSelected ? `${selected.size} selected` : `${shows.length} items`}
            </span>
          </div>
          {shows.map((show, idx) => (
            <ShowListRow
              key={show.id}
              show={show}
              selected={selected.has(show.id)}
              index={idx}
              nonce={listNonce}
              isNew={!!lastScanAt && new Date(show.createdAt) >= new Date(lastScanAt)}
              onToggle={(e) => toggleOne(show.id, idx, e.shiftKey)}
            />
          ))}
        </div>
      )}

      {/* Batch action bar */}
      {filter.view === 'list' && someSelected && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-gray-900 border border-gray-700 rounded-xl px-5 py-3 shadow-2xl">
          <span className="text-sm text-gray-300 font-medium">{selected.size} selected</span>
          <div className="w-px h-4 bg-gray-700" />
          <button
            onClick={() => { void handleBatchRematch() }}
            className="text-xs px-3 py-1.5 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 transition-colors"
          >
            Rematch
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Deselect
          </button>
        </div>
      )}

    </div>
  )
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { HealthItem, HealthFilter, JobStatus } from '../api/library-health.js'
import {
  fetchHealthItems,
  fetchHealthSummary,
  startBulkArtworkDownload,
  fetchJobStatus,
  refreshMetadata,
} from '../api/library-health.js'

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

function SummaryCard({ label, count, filter, activeFilter, onFilter }: {
  label: string
  count: number
  filter: Partial<HealthFilter>
  activeFilter: HealthFilter
  onFilter: (f: HealthFilter) => void
}) {
  const isActive = Object.entries(filter).every(
    ([k, v]) => activeFilter[k as keyof HealthFilter] === v,
  )
  return (
    <button
      onClick={() => onFilter(isActive ? {} : filter)}
      className={[
        'flex flex-col items-center justify-center rounded-lg border p-4 text-center transition-colors min-w-0',
        count === 0
          ? 'border-gray-800 text-gray-600'
          : isActive
            ? 'border-accent/60 bg-accent/10 text-accent'
            : 'border-gray-700 hover:border-gray-500 text-gray-300',
      ].join(' ')}
    >
      <span className={`text-2xl font-bold ${count > 0 ? 'text-white' : ''}`}>{count}</span>
      <span className="text-xs mt-0.5">{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Job progress bar
// ---------------------------------------------------------------------------

function JobProgress({ job, onDone }: { job: JobStatus; onDone: () => void }) {
  const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0

  return (
    <div className="bg-surface-raised border border-gray-700 rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-300">{job.running ? 'Running…' : 'Done'}</span>
        <span className="text-gray-500">
          {job.done}/{job.total} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${job.running ? 'bg-accent' : 'bg-green-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {job.errors.length > 0 && (
        <p className="text-xs text-yellow-400">{job.errors.length} error(s) occurred</p>
      )}
      {!job.running && (
        <button
          onClick={onDone}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Dismiss
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Score badge
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: number }) {
  const color =
    score === 5 ? 'text-green-400' : score >= 3 ? 'text-yellow-400' : 'text-red-400'
  return <span className={`font-medium ${color}`}>{score}/5</span>
}

// ---------------------------------------------------------------------------
// Check / X indicators
// ---------------------------------------------------------------------------

function Check({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? 'text-green-500' : 'text-red-500'}>
      {ok ? '✓' : '✗'}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function HealthPage() {
  const [items, setItems] = useState<HealthItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<HealthFilter>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [summary, setSummary] = useState({ missingPoster: 0, missingBackdrop: 0, unmatched: 0, noFiles: 0 })
  const [activeJob, setActiveJob] = useState<JobStatus | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [data, sum] = await Promise.all([
        fetchHealthItems(filter),
        fetchHealthSummary(),
      ])
      setItems(data)
      setSummary(sum)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  // Poll active job
  useEffect(() => {
    if (!activeJob) return
    if (!activeJob.running) return

    pollRef.current = setInterval(async () => {
      try {
        const updated = await fetchJobStatus(activeJob.id)
        setActiveJob(updated)
        if (!updated.running) {
          clearInterval(pollRef.current ?? undefined)
          void load()
        }
      } catch {
        clearInterval(pollRef.current ?? undefined)
      }
    }, 2000)

    return () => { clearInterval(pollRef.current ?? undefined) }
  }, [activeJob, load])

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === items.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(items.map((i) => i.id)))
    }
  }

  async function bulkDownloadArt() {
    try {
      const res = await startBulkArtworkDownload('all')
      if (!res.jobId) {
        setError('Nothing to download')
        return
      }
      const job = await fetchJobStatus(res.jobId)
      setActiveJob(job)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start download')
    }
  }

  async function refreshSelected() {
    const movieIds = items.filter((i) => selected.has(i.id) && i.type === 'movie').map((i) => i.id)
    const showIds = items.filter((i) => selected.has(i.id) && i.type === 'show').map((i) => i.id)
    if (movieIds.length + showIds.length === 0) return
    try {
      const res = await refreshMetadata(movieIds, showIds)
      const job = await fetchJobStatus(res.jobId)
      setActiveJob(job)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start refresh')
    }
  }

  const summaryCards: { label: string; count: number; filter: Partial<HealthFilter> }[] = [
    { label: 'Missing poster', count: summary.missingPoster, filter: { missingPoster: true } },
    { label: 'Missing backdrop', count: summary.missingBackdrop, filter: { missingBackdrop: true } },
    { label: 'Unmatched', count: summary.unmatched, filter: { unmatched: true } },
    { label: 'No files', count: summary.noFiles, filter: { noFiles: true } },
  ]

  const selectedMovieIds = items.filter((i) => selected.has(i.id) && i.type === 'movie').map((i) => i.id)
  const selectedShowIds = items.filter((i) => selected.has(i.id) && i.type === 'show').map((i) => i.id)
  const hasMatchedSelected =
    items.filter((i) => selected.has(i.id) && i.matched).length > 0

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-2xl font-bold">Library Health</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {summaryCards.map(({ label, count, filter: f }) => (
          <SummaryCard
            key={label}
            label={label}
            count={count}
            filter={f}
            activeFilter={filter}
            onFilter={setFilter}
          />
        ))}
      </div>

      {/* Job progress */}
      {activeJob && (
        <JobProgress job={activeJob} onDone={() => setActiveJob(null)} />
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">Type:</span>
        {([
          { key: undefined, label: 'All' },
          { key: 'movies' as const, label: 'Movies' },
          { key: 'shows' as const, label: 'Shows' },
        ] as { key: HealthFilter['type']; label: string }[]).map(({ key, label }) => (
          <button
            key={label}
            onClick={() => setFilter((f) => {
              const { type: _, ...rest } = f
              return key ? { ...rest, type: key } : rest
            })}
            className={[
              'px-2 py-1 rounded transition-colors',
              filter.type === key
                ? 'bg-accent/20 text-accent'
                : 'text-gray-400 hover:text-gray-200',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
        <label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none text-gray-400">
          <input
            type="checkbox"
            checked={!!filter.incomplete}
            onChange={(e) => setFilter((f) => {
              const { incomplete: _, ...rest } = f
              return e.target.checked ? { ...rest, incomplete: true } : rest
            })}
            className="accent-accent"
          />
          Incomplete only
        </label>
        {Object.keys(filter).length > 0 && (
          <button
            onClick={() => setFilter({})}
            className="ml-auto text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Bulk actions */}
      {items.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selected.size === items.length && items.length > 0}
              onChange={toggleAll}
              className="accent-accent"
            />
            {selected.size}/{items.length} selected
          </label>
          <button
            onClick={bulkDownloadArt}
            disabled={!!activeJob?.running}
            className="text-sm px-3 py-1.5 rounded bg-surface-overlay hover:bg-gray-600 disabled:opacity-40 transition-colors"
          >
            Download all missing art
          </button>
          <button
            onClick={refreshSelected}
            disabled={!!activeJob?.running || !hasMatchedSelected}
            className="text-sm px-3 py-1.5 rounded bg-surface-overlay hover:bg-gray-600 disabled:opacity-40 transition-colors"
          >
            Refresh metadata ({selectedMovieIds.length + selectedShowIds.length})
          </button>
        </div>
      )}

      {loading && <div className="py-12 text-center text-gray-500">Loading…</div>}

      {!loading && items.length === 0 && (
        <div className="py-12 text-center text-gray-500 text-sm">
          {Object.keys(filter).length > 0
            ? 'No items match the current filters.'
            : 'Library is fully healthy.'}
        </div>
      )}

      {/* Items table */}
      {!loading && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="pb-2 pr-3 w-8"></th>
                <th className="pb-2 pr-4">Title</th>
                <th className="pb-2 pr-4 text-center">Type</th>
                <th className="pb-2 pr-4 text-center">Poster</th>
                <th className="pb-2 pr-4 text-center">Backdrop</th>
                <th className="pb-2 pr-4 text-center">Matched</th>
                <th className="pb-2 pr-4 text-center">Metadata</th>
                <th className="pb-2 pr-4 text-center">Files</th>
                <th className="pb-2 text-center">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {items.map((item) => {
                const href = item.type === 'movie' ? `/movies/${item.id}` : `/shows/${item.id}`
                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-surface-raised transition-colors ${selected.has(item.id) ? 'bg-accent/5' : ''}`}
                  >
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleItem(item.id)}
                        className="accent-accent"
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <Link
                        to={href}
                        className="text-gray-100 hover:text-accent transition-colors truncate block max-w-xs"
                      >
                        {item.title}
                        {item.year && <span className="text-gray-500 ml-1 text-xs">({item.year})</span>}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${item.type === 'movie' ? 'bg-blue-900/40 text-blue-300' : 'bg-purple-900/40 text-purple-300'}`}>
                        {item.type === 'movie' ? 'Movie' : 'Show'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-center"><Check ok={item.posterDownloaded} /></td>
                    <td className="py-2 pr-4 text-center"><Check ok={item.backdropDownloaded} /></td>
                    <td className="py-2 pr-4 text-center"><Check ok={item.matched} /></td>
                    <td className="py-2 pr-4 text-center"><Check ok={item.metadataComplete} /></td>
                    <td className="py-2 pr-4 text-center"><Check ok={item.hasFiles} /></td>
                    <td className="py-2 text-center"><ScoreBadge score={item.score} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

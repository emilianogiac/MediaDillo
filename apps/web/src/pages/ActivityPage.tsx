import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { fetchActivity, revertActivityEntries } from '../api/activity.js'
import type { ActivityLogEntry, ActivityAction } from '../api/activity.js'
import { useToast } from '../context/ToastContext.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<ActivityAction, string> = {
  rename: 'Rename',
  cleanup: 'Cleanup',
  scan_complete: 'Scan',
  item_added: 'Added',
  item_removed: 'Removed',
  collection_move: 'Moved',
  episode_merge: 'Merge',
  episode_assign: 'Assign',
}

const ACTION_ICONS: Record<ActivityAction, string> = {
  rename: '✏️',
  cleanup: '🗑',
  scan_complete: '🔍',
  item_added: '➕',
  item_removed: '✖',
  collection_move: '📦',
  episode_merge: '🔗',
  episode_assign: '🎯',
}

const ALL_ACTIONS: ActivityAction[] = [
  'rename',
  'cleanup',
  'scan_complete',
  'item_added',
  'item_removed',
  'collection_move',
  'episode_merge',
  'episode_assign',
]

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

function formatRelative(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

function formatAbsolute(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

function formatDateGroup(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function buildDescription(entry: ActivityLogEntry): string {
  const detail = entry.detail ?? {}

  switch (entry.action) {
    case 'rename': {
      const isFolder = detail['type'] === 'folder'
      const from = entry.fromPath ? basename(entry.fromPath) : '?'
      const to = entry.toPath ? basename(entry.toPath) : '?'
      if (from === to) return `Renamed ${isFolder ? 'folder' : 'file'}: ${from}`
      return `${from} → ${to}`
    }
    case 'cleanup':
      return `Trashed: ${entry.filePath ? basename(entry.filePath) : '?'}`
    case 'scan_complete': {
      const added = typeof detail['filesAdded'] === 'number' ? detail['filesAdded'] : 0
      const removed = typeof detail['filesRemoved'] === 'number' ? detail['filesRemoved'] : 0
      const changed = typeof detail['filesChanged'] === 'number' ? detail['filesChanged'] : 0
      return `Scan complete — +${added} / −${removed} / ~${changed}`
    }
    case 'item_added':
      return `Added: ${entry.filePath ? basename(entry.filePath) : '?'}`
    case 'item_removed': {
      const title = typeof detail['title'] === 'string' ? detail['title'] : null
      return `Removed: ${title ?? (entry.filePath ? basename(entry.filePath) : '?')}`
    }
    case 'collection_move': {
      const from = entry.fromPath ? basename(entry.fromPath) : '?'
      const to = entry.toPath ? basename(entry.toPath) : '?'
      return `Moved ${from} → ${to}`
    }
    case 'episode_merge':
      return `Merged parts → ${entry.filePath ? basename(entry.filePath) : '?'}`
    case 'episode_assign': {
      const reason = typeof detail['reason'] === 'string' ? detail['reason'] : 'assign'
      return `Episode ${reason}: ${entry.filePath ? basename(entry.filePath) : '?'}`
    }
    default:
      return entry.action
  }
}

function canRevert(entry: ActivityLogEntry): boolean {
  return (entry.action === 'rename' || entry.action === 'collection_move') && !entry.revertedAt
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface ActivityRowProps {
  entry: ActivityLogEntry
  selected: boolean
  onToggle: (id: string) => void
}

function ActivityRow({ entry, selected, onToggle }: ActivityRowProps) {
  const showCheckbox = canRevert(entry)

  return (
    <div
      className={[
        'flex items-start gap-3 px-4 py-3 border-b border-gray-800 hover:bg-white/5 transition-colors',
        entry.revertedAt ? 'opacity-50' : '',
      ].join(' ')}
    >
      {showCheckbox ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(entry.id)}
          className="mt-1 accent-accent flex-shrink-0"
        />
      ) : (
        <div className="w-4 flex-shrink-0" />
      )}

      <span className="text-base leading-none mt-0.5 flex-shrink-0" title={ACTION_LABELS[entry.action]}>
        {ACTION_ICONS[entry.action]}
      </span>

      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-100 truncate">{buildDescription(entry)}</div>
        <div className="flex items-center gap-2 mt-0.5">
          {entry.movieId && (
            <Link
              to={`/movies/${entry.movieId}`}
              className="text-xs text-accent hover:underline"
            >
              movie
            </Link>
          )}
          {entry.showId && (
            <Link
              to={`/shows/${entry.showId}`}
              className="text-xs text-accent hover:underline"
            >
              show
            </Link>
          )}
          {entry.revertedAt && (
            <span className="text-xs text-yellow-500">reverted</span>
          )}
          {entry.revertOfId && (
            <span className="text-xs text-gray-500">revert</span>
          )}
        </div>
      </div>

      <span
        className="text-xs text-gray-500 flex-shrink-0 mt-0.5"
        title={formatAbsolute(entry.createdAt)}
      >
        {formatRelative(entry.createdAt)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50

export function ActivityPage() {
  const { toast } = useToast()
  const [activeActions, setActiveActions] = useState<Set<ActivityAction>>(new Set())
  const [items, setItems] = useState<ActivityLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reverting, setReverting] = useState(false)

  const load = useCallback(async (newOffset: number, actions: Set<ActivityAction>) => {
    setLoading(true)
    try {
      const result = await fetchActivity({
        ...(actions.size > 0 ? { action: [...actions] } : {}),
        limit: PAGE_SIZE,
        offset: newOffset,
      })
      setItems(result.items)
      setTotal(result.total)
      setOffset(newOffset)
      setSelected(new Set())
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to load activity' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load(0, activeActions)
  }, [load, activeActions])

  function toggleActionFilter(action: ActivityAction) {
    setActiveActions((prev) => {
      const next = new Set(prev)
      if (next.has(action)) next.delete(action)
      else next.add(action)
      return next
    })
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleRevert() {
    if (selected.size === 0) return
    setReverting(true)
    try {
      const result = await revertActivityEntries([...selected])
      const okCount = result.ok.length
      const failCount = result.failed.length
      if (okCount > 0) {
        toast({ type: 'success', message: `Reverted ${okCount} item${okCount !== 1 ? 's' : ''}` })
      }
      if (failCount > 0) {
        const msgs = result.failed.map((f) => f.error).join('; ')
        toast({ type: 'error', message: `${failCount} failed: ${msgs}` })
      }
      await load(offset, activeActions)
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'Revert failed' })
    } finally {
      setReverting(false)
    }
  }

  // Group items by date label
  const groups: Array<{ label: string; entries: ActivityLogEntry[] }> = []
  for (const entry of items) {
    const label = formatDateGroup(entry.createdAt)
    const last = groups[groups.length - 1]
    if (last?.label === label) {
      last.entries.push(entry)
    } else {
      groups.push({ label, entries: [entry] })
    }
  }

  const revertableSelected = items.filter((e) => selected.has(e.id) && canRevert(e))
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Activity Log</h1>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setActiveActions(new Set())}
          className={[
            'px-3 py-1 rounded-full text-sm transition-colors',
            activeActions.size === 0
              ? 'bg-accent text-black font-medium'
              : 'bg-white/10 text-gray-300 hover:bg-white/20',
          ].join(' ')}
        >
          All
        </button>
        {ALL_ACTIONS.map((action) => (
          <button
            key={action}
            onClick={() => toggleActionFilter(action)}
            className={[
              'px-3 py-1 rounded-full text-sm transition-colors flex items-center gap-1',
              activeActions.has(action)
                ? 'bg-accent text-black font-medium'
                : 'bg-white/10 text-gray-300 hover:bg-white/20',
            ].join(' ')}
          >
            <span>{ACTION_ICONS[action]}</span>
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>

      {/* Revert toolbar */}
      {revertableSelected.length > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-surface-raised rounded-lg border border-gray-700">
          <span className="text-sm text-gray-300">
            {revertableSelected.length} item{revertableSelected.length !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handleRevert}
            disabled={reverting}
            className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 text-black rounded text-sm font-medium disabled:opacity-50"
          >
            {reverting ? 'Reverting…' : 'Revert selected'}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-3 py-1 bg-white/10 hover:bg-white/20 text-gray-300 rounded text-sm"
          >
            Clear
          </button>
        </div>
      )}

      {/* List */}
      <div className="bg-surface-raised rounded-lg border border-gray-800 overflow-hidden">
        {loading && (
          <div className="p-8 text-center text-gray-500">Loading…</div>
        )}

        {!loading && items.length === 0 && (
          <div className="p-8 text-center text-gray-500">No activity yet.</div>
        )}

        {!loading && groups.map((group) => (
          <div key={group.label}>
            <div className="px-4 py-2 bg-white/5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {group.label}
            </div>
            {group.entries.map((entry) => (
              <ActivityRow
                key={entry.id}
                entry={entry}
                selected={selected.has(entry.id)}
                onToggle={toggleSelect}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={currentPage <= 1}
              onClick={() => load(offset - PAGE_SIZE, activeActions)}
              className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-2 py-1">
              Page {currentPage} / {totalPages}
            </span>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => load(offset + PAGE_SIZE, activeActions)}
              className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

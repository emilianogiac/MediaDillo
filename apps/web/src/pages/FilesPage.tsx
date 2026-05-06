import { useState, useEffect, useCallback } from 'react'
import type {
  RenamePreviewItem,
  StaleFile,
} from '../api/files.js'
import {
  fetchRenamePreview,
  applyRenames,
  fetchStaleFiles,
  deleteStaleFile,
  resolveStaleFile,
  bulkDeleteStaleFiles,
} from '../api/files.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basename(p: string) {
  return p.split('/').pop() ?? p
}

function dirname(p: string) {
  const parts = p.split('/')
  parts.pop()
  return parts.join('/')
}

// ---------------------------------------------------------------------------
// Rename Queue tab
// ---------------------------------------------------------------------------

function RenameTab() {
  const [type, setType] = useState<'movies' | 'episodes'>('movies')
  const [items, setItems] = useState<RenamePreviewItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ renamed: number; errors: string[] } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const all = await fetchRenamePreview(type)
      const pending = all.filter((i) => i.needsRename)
      setItems(pending)
      setSelected(new Set(pending.map((i) => i.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [type])

  useEffect(() => { load() }, [load])

  function toggle(id: string) {
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

  async function apply() {
    const ids = [...selected]
    if (ids.length === 0) return
    setApplying(true)
    setError(null)
    setResult(null)
    try {
      const res = await applyRenames(type, ids)
      await load()
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Type toggle */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500">Library:</span>
        {(['movies', 'episodes'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={[
              'px-3 py-1 rounded text-sm transition-colors',
              type === t ? 'bg-accent/20 text-accent' : 'text-gray-400 hover:text-gray-200',
            ].join(' ')}
          >
            {t === 'movies' ? 'Movies' : 'TV Episodes'}
          </button>
        ))}
      </div>

      {loading && <div className="py-8 text-center text-gray-500">Scanning…</div>}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <div className={`text-sm p-3 rounded ${result.errors.length > 0 ? 'bg-yellow-900/30 text-yellow-300' : 'bg-green-900/30 text-green-300'}`}>
          {result.renamed} file{result.renamed !== 1 ? 's' : ''} renamed.
          {result.errors.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-yellow-400">
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="py-12 text-center text-gray-500 text-sm">
          All {type === 'movies' ? 'movie' : 'episode'} files follow the naming convention.
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selected.size === items.length}
                onChange={toggleAll}
                className="accent-accent"
              />
              {selected.size}/{items.length} selected
            </label>
            <button
              onClick={apply}
              disabled={applying || selected.size === 0}
              className="px-4 py-1.5 text-sm rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-40 transition-colors"
            >
              {applying ? 'Applying…' : `Rename ${selected.size} file${selected.size !== 1 ? 's' : ''}`}
            </button>
          </div>

          <div className="space-y-2">
            {items.map((item) => {
              const currentDir = dirname(item.currentPath)
              const proposedDir = dirname(item.proposedPath)
              const dirChanged = currentDir !== proposedDir

              return (
                <label
                  key={item.id}
                  className="flex items-start gap-3 bg-surface-raised border border-gray-700 rounded-lg p-3 cursor-pointer hover:border-gray-600 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    className="mt-0.5 accent-accent flex-shrink-0"
                  />
                  <div className="min-w-0 space-y-1 flex-1">
                    {dirChanged && (
                      <div className="text-xs text-yellow-500">
                        Folder: <span className="font-mono">{basename(currentDir)}</span>
                        {' → '}
                        <span className="font-mono">{basename(proposedDir)}</span>
                      </div>
                    )}
                    <div className="text-xs font-mono">
                      <span className="text-red-400 line-through truncate block">{basename(item.currentPath)}</span>
                      <span className="text-green-400 truncate block">{basename(item.proposedPath)}</span>
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stale Files tab
// ---------------------------------------------------------------------------

function StaleTab() {
  const [items, setItems] = useState<StaleFile[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchStaleFiles()
      setItems(data.items)
      setTotal(data.total)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function toggle(id: string) {
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

  async function deleteSingle(id: string) {
    setBusy(true)
    try {
      await deleteStaleFile(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  async function resolveSingle(id: string) {
    setBusy(true)
    try {
      await resolveStaleFile(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resolve failed')
    } finally {
      setBusy(false)
    }
  }

  async function bulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    setBusy(true)
    try {
      await bulkDeleteStaleFiles(ids)
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)))
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk delete failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="py-8 text-center text-gray-500">Loading…</div>

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{total} unresolved stale file{total !== 1 ? 's' : ''}</span>
        {items.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selected.size === items.length}
                onChange={toggleAll}
                className="accent-accent"
              />
              {selected.size}/{items.length}
            </label>
            <button
              onClick={bulkDelete}
              disabled={busy || selected.size === 0}
              className="text-sm px-3 py-1 rounded bg-red-800/60 hover:bg-red-700/60 text-red-300 disabled:opacity-40 transition-colors"
            >
              {busy ? 'Working…' : `Delete ${selected.size} to trash`}
            </button>
          </div>
        )}
      </div>

      {items.length === 0 && (
        <div className="py-12 text-center text-gray-500 text-sm">No stale files to review.</div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 bg-surface-raised border border-gray-700 rounded-lg p-3"
            >
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                className="mt-0.5 accent-accent flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-gray-300 truncate" title={item.path}>
                  {item.path}
                </p>
                {item.reason && (
                  <p className="text-xs text-gray-500 mt-0.5">{item.reason}</p>
                )}
                <p className="text-xs text-gray-600 mt-0.5">
                  Found {new Date(item.scanLog.startedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex-shrink-0 flex gap-2">
                <button
                  onClick={() => resolveSingle(item.id)}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded text-gray-400 hover:text-gray-200 bg-surface-overlay transition-colors disabled:opacity-40"
                  title="Mark as resolved (keep file)"
                >
                  Ignore
                </button>
                <button
                  onClick={() => deleteSingle(item.id)}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded text-red-400 hover:text-red-300 bg-red-900/30 transition-colors disabled:opacity-40"
                  title="Move to .trash/"
                >
                  Trash
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'rename' | 'stale'

export function FilesPage() {
  const [tab, setTab] = useState<Tab>('rename')

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">File Manager</h1>

      <div className="flex gap-1 border-b border-gray-800">
        {([
          { key: 'rename', label: 'Rename Queue' },
          { key: 'stale', label: 'Stale Files' },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={[
              'px-4 py-2 text-sm font-medium -mb-px border transition-colors rounded-t',
              tab === key
                ? 'bg-surface-raised text-white border-gray-700 border-b-surface-raised'
                : 'text-gray-400 hover:text-gray-200 border-transparent',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'rename' ? <RenameTab /> : <StaleTab />}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { fetchRenamePreview, applyRenames, fetchRenameLog, revertRename, type RenamePreviewItem, type RenameLogEntry } from '../api/files.js'

interface Props {
  movieId: string
  onDone: () => void
}

export function MovieFilesPanel({ movieId, onDone }: Props) {
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [items, setItems] = useState<RenamePreviewItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<{ message: string; errors: string[] } | null>(null)
  const [log, setLog] = useState<RenameLogEntry[]>([])
  const [showLog, setShowLog] = useState(false)
  const [revertingId, setRevertingId] = useState<string | null>(null)
  const [revertResult, setRevertResult] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setResult(null)
    try {
      const [preview, renameLog] = await Promise.all([
        fetchRenamePreview('movies', [movieId]),
        fetchRenameLog(movieId),
      ])
      const needsRename = preview.filter((i) => i.needsRename)
      setItems(needsRename)
      setSelected(new Set(needsRename.map((i) => i.id)))
      setLog(renameLog)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [movieId])

  async function handleApply() {
    if (selected.size === 0) return
    setApplying(true)
    setResult(null)
    try {
      const r = await applyRenames('movies', [...selected])
      const message = r.errors.length > 0
        ? `${r.renamed} renamed, ${r.errors.length} error(s)`
        : r.renamed > 0 ? `${r.renamed} file(s) renamed` : 'Nothing to rename'
      setResult({ message, errors: r.errors })
      onDone()
      await load()
    } catch (e) {
      setResult({ message: e instanceof Error ? e.message : 'Rename failed', errors: [] })
    } finally {
      setApplying(false)
    }
  }

  async function handleRevert(logId: string) {
    setRevertingId(logId)
    setRevertResult(null)
    try {
      await revertRename(logId)
      setRevertResult('Reverted')
      onDone()
      await load()
    } catch (e) {
      setRevertResult(e instanceof Error ? e.message : 'Revert failed')
    } finally {
      setRevertingId(null)
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function basename(p: string) {
    return p.split('/').pop() ?? p
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Rename &amp; Organize</h2>

      <div className="bg-surface-raised border border-gray-700 rounded-lg p-4 space-y-3">
        {loading && <p className="text-sm text-gray-500">Loading…</p>}

        {!loading && items.length === 0 && (
          <p className="text-sm text-gray-500">Files are already canonical — nothing to rename.</p>
        )}

        {!loading && items.length > 0 && (
          <>
            <div className="space-y-2">
              {items.map((item) => (
                <label key={item.id} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-accent"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <div className="text-xs font-mono space-y-0.5">
                    <p className="text-gray-400 line-through">{basename(item.currentPath)}</p>
                    <p className="text-green-400">{basename(item.proposedPath)}</p>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => { void handleApply() }}
                disabled={applying || selected.size === 0}
                className="text-xs px-3 py-1.5 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 transition-colors disabled:opacity-40"
              >
                {applying ? 'Applying…' : `Apply (${selected.size})`}
              </button>
              {result && (
                <div className="text-xs space-y-0.5">
                  <span className={result.errors.length > 0 ? 'text-yellow-400' : 'text-gray-400'}>{result.message}</span>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-red-400 font-mono">{e}</p>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {log.length > 0 && (
        <div className="space-y-1">
          <button
            onClick={() => setShowLog((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span className={`transition-transform ${showLog ? 'rotate-90' : ''}`}>▶</span>
            Rename history ({log.length})
          </button>

          {showLog && (
            <div className="bg-surface-raised border border-gray-700 rounded-lg divide-y divide-gray-700/60">
              {revertResult && (
                <div className="px-4 py-2">
                  <span className="text-xs text-gray-400">{revertResult}</span>
                </div>
              )}
              {log.map((entry) => (
                <div key={entry.id} className="px-4 py-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">{formatDate(entry.createdAt)}</span>
                      <span className={`text-xs px-1 rounded ${entry.trigger === 'manual' ? 'bg-gray-700 text-gray-400' : 'bg-yellow-900/60 text-yellow-400'}`}>
                        {entry.trigger}
                      </span>
                    </div>
                    <button
                      onClick={() => { void handleRevert(entry.id) }}
                      disabled={revertingId !== null}
                      className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-500 hover:border-orange-600/50 hover:text-orange-400 transition-colors disabled:opacity-40 shrink-0"
                      title="Move file back to this name"
                    >
                      {revertingId === entry.id ? 'Reverting…' : 'Revert'}
                    </button>
                  </div>
                  <p className="text-xs font-mono text-gray-500 line-through">{basename(entry.fromPath)}</p>
                  <p className="text-xs font-mono text-gray-300">{basename(entry.toPath)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

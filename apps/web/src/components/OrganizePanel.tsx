import { useState, useCallback } from 'react'
import type { OrganizePreview, OrganizeRenameItem, OrganizeRemoval } from '../api/shows.js'
import { fetchOrganizePreview, applyOrganize } from '../api/shows.js'

interface Props {
  showId: string
  onDone?: () => void
}

function basename(p: string) {
  return p.split('/').pop() ?? p
}

function shortPath(full: string, base: string) {
  return full.startsWith(base) ? full.slice(base.length + 1) : full
}

export function OrganizePanel({ showId, onDone }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [preview, setPreview] = useState<OrganizePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ renamed: number; trashed: number; errors: string[] } | null>(null)

  const [selectedRenames, setSelectedRenames] = useState<Set<string>>(new Set())
  const [selectedTrash, setSelectedTrash] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await fetchOrganizePreview(showId)
      setPreview(data)
      setSelectedRenames(new Set(data.renames.map((r) => r.id)))
      setSelectedTrash(new Set(data.removals.map((r) => r.path)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load preview')
    } finally {
      setLoading(false)
    }
  }, [showId])

  function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next && !preview && !loading) load()
  }

  function toggleRename(id: string) {
    setSelectedRenames((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleTrash(path: string) {
    setSelectedTrash((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  function selectAllRenames(renames: OrganizeRenameItem[]) {
    setSelectedRenames(new Set(renames.map((r) => r.id)))
  }

  function selectNoneRenames() {
    setSelectedRenames(new Set())
  }

  function selectAllTrash(removals: OrganizeRemoval[]) {
    setSelectedTrash(new Set(removals.map((r) => r.path)))
  }

  function selectNoneTrash() {
    setSelectedTrash(new Set())
  }

  async function apply() {
    if (!preview) return
    setApplying(true)
    setError(null)
    try {
      const res = await applyOrganize(showId, [...selectedRenames], [...selectedTrash])
      setResult(res)
      if (res.renamed > 0 || res.trashed > 0) {
        setPreview(null)
        onDone?.()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setApplying(false)
    }
  }

  const hasWork = selectedRenames.size > 0 || selectedTrash.size > 0

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={toggleOpen}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-raised hover:bg-gray-700/40 transition-colors text-left"
      >
        <span className="text-sm font-medium text-gray-200">Cleanup &amp; Organize</span>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-4 space-y-5 bg-surface border-t border-gray-700">
          {loading && <p className="text-sm text-gray-400">Scanning…</p>}

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          {result && (
            <div className="text-sm space-y-1">
              {result.renamed > 0 && (
                <p className="text-green-400">✓ {result.renamed} file{result.renamed !== 1 ? 's' : ''} renamed</p>
              )}
              {result.trashed > 0 && (
                <p className="text-green-400">✓ {result.trashed} file{result.trashed !== 1 ? 's' : ''} moved to trash</p>
              )}
              {result.errors.map((e, i) => (
                <p key={i} className="text-red-400">✗ {e}</p>
              ))}
              <button
                onClick={load}
                className="mt-2 text-xs text-accent hover:underline"
              >
                Re-scan
              </button>
            </div>
          )}

          {preview && !result && (
            <>
              {/* Renames */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-300">
                    Files to rename
                    {preview.renames.length === 0 && (
                      <span className="ml-2 text-xs text-green-500 font-normal">— all clean</span>
                    )}
                  </h3>
                  {preview.renames.length > 0 && (
                    <div className="flex gap-2 text-xs text-gray-500">
                      <button onClick={() => selectAllRenames(preview.renames)} className="hover:text-accent">all</button>
                      <span>/</span>
                      <button onClick={selectNoneRenames} className="hover:text-accent">none</button>
                    </div>
                  )}
                </div>
                {preview.renames.map((item) => (
                  <label key={item.id} className="flex items-start gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={selectedRenames.has(item.id)}
                      onChange={() => toggleRename(item.id)}
                      className="mt-0.5 accent-accent flex-shrink-0"
                    />
                    <div className="min-w-0 text-xs space-y-0.5">
                      <p className="text-gray-400 truncate" title={item.currentPath}>
                        <span className="text-gray-600">from: </span>
                        {shortPath(item.currentPath, preview.showFolder)}
                      </p>
                      <p className="text-gray-200 truncate" title={item.proposedPath}>
                        <span className="text-gray-600">to: </span>
                        {shortPath(item.proposedPath, preview.showFolder)}
                      </p>
                    </div>
                  </label>
                ))}
              </div>

              {/* Removals */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-300">
                    Files to remove
                    {preview.removals.length === 0 && (
                      <span className="ml-2 text-xs text-green-500 font-normal">— nothing stale</span>
                    )}
                  </h3>
                  {preview.removals.length > 0 && (
                    <div className="flex gap-2 text-xs text-gray-500">
                      <button onClick={() => selectAllTrash(preview.removals)} className="hover:text-accent">all</button>
                      <span>/</span>
                      <button onClick={selectNoneTrash} className="hover:text-accent">none</button>
                    </div>
                  )}
                </div>
                {preview.removals.map((item) => (
                  <label key={item.path} className="flex items-start gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={selectedTrash.has(item.path)}
                      onChange={() => toggleTrash(item.path)}
                      className="mt-0.5 accent-accent flex-shrink-0"
                    />
                    <div className="min-w-0 text-xs space-y-0.5">
                      <p className="text-gray-200 truncate" title={item.path}>
                        {basename(item.path)}
                      </p>
                      <p className="text-gray-500">{item.reason}</p>
                    </div>
                  </label>
                ))}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={apply}
                  disabled={applying || !hasWork}
                  className="text-sm px-4 py-1.5 rounded bg-accent text-black font-medium hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {applying ? 'Applying…' : 'Apply selected'}
                </button>
                <button
                  onClick={load}
                  disabled={loading}
                  className="text-xs text-gray-500 hover:text-accent transition-colors"
                >
                  Refresh
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

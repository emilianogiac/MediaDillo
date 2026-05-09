import { useState, useCallback } from 'react'
import type { RenamePreviewItem } from '../api/files.js'
import { applyRenames } from '../api/files.js'
import { useToast } from '../context/ToastContext.js'

interface Props {
  fetchPreview: () => Promise<RenamePreviewItem[]>
  onDone: () => void
  title?: string
}

function shortName(p: string) {
  return p.split('/').pop() ?? p
}

export function EpisodeRenamePanel({ fetchPreview, onDone, title = 'Rename Episodes' }: Props) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [preview, setPreview] = useState<RenamePreviewItem[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<{ renamed: number; errors: string[] } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setResult(null)
    try {
      const items = await fetchPreview()
      setPreview(items)
      setSelected(new Set(items.filter((i) => i.needsRename && i.type === 'episode-file').map((i) => i.id)))
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to load preview' })
    } finally {
      setLoading(false)
    }
  }, [fetchPreview])

  function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next && !preview && !loading) load()
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function apply() {
    if (!preview) return
    const fileIds = [...selected]
    const showFolderItems = preview.filter((p) => p.type === 'show-folder')
    setApplying(true)
    try {
      const res = await applyRenames('episodes', fileIds, showFolderItems.length > 0 ? showFolderItems : undefined)
      setResult(res)
      if (res.renamed > 0) {
        toast({ type: 'success', message: `${res.renamed} episode file${res.renamed !== 1 ? 's' : ''} renamed` })
        setPreview(null)
        onDone()
      }
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Apply failed' })
    } finally {
      setApplying(false)
    }
  }

  const renameItems = preview?.filter((p) => p.needsRename && p.type === 'episode-file') ?? []
  const alreadyClean = preview !== null && renameItems.length === 0
  const hasSelection = selected.size > 0

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={toggleOpen}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-raised hover:bg-gray-700/40 transition-colors text-left"
      >
        <span className="text-sm font-medium text-gray-200">{title}</span>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-4 space-y-4 bg-surface border-t border-gray-700">
          {loading && <p className="text-sm text-gray-400">Scanning…</p>}

          {result && result.errors.map((e, i) => (
            <p key={i} className="text-sm text-red-400">✗ {e}</p>
          ))}

          {!loading && alreadyClean && (
            <p className="text-sm text-green-500">✓ All filenames are already canonical</p>
          )}

          {!loading && preview && renameItems.length > 0 && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">{renameItems.length} file{renameItems.length !== 1 ? 's' : ''} need renaming</p>
                  <div className="flex gap-2 text-xs text-gray-500">
                    <button onClick={() => setSelected(new Set(renameItems.map((i) => i.id)))} className="hover:text-accent">all</button>
                    <span>/</span>
                    <button onClick={() => setSelected(new Set())} className="hover:text-accent">none</button>
                  </div>
                </div>
                {renameItems.map((item) => (
                  <label key={item.id} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                      className="mt-0.5 accent-accent flex-shrink-0"
                    />
                    <div className="min-w-0 text-xs space-y-0.5">
                      <p className="text-gray-500 truncate" title={item.currentPath}>
                        <span className="text-gray-600">from: </span>{shortName(item.currentPath)}
                      </p>
                      <p className="text-gray-200 truncate" title={item.proposedPath}>
                        <span className="text-gray-600">to: </span>{shortName(item.proposedPath)}
                      </p>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={apply}
                  disabled={applying || !hasSelection}
                  className="text-sm px-4 py-1.5 rounded bg-accent text-black font-medium hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {applying ? 'Renaming…' : `Rename ${selected.size} file${selected.size !== 1 ? 's' : ''}`}
                </button>
                <button onClick={load} disabled={loading} className="text-xs text-gray-500 hover:text-accent transition-colors">
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

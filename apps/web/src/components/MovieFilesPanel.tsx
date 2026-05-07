import { useState, useEffect } from 'react'
import { fetchRenamePreview, applyRenames, type RenamePreviewItem } from '../api/files.js'

interface Props {
  movieId: string
  onDone: () => void
}

export function MovieFilesPanel({ movieId, onDone }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [items, setItems] = useState<RenamePreviewItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setResult(null)
    try {
      const preview = await fetchRenamePreview('movies', [movieId])
      const needsRename = preview.filter((i) => i.needsRename)
      setItems(needsRename)
      setSelected(new Set(needsRename.map((i) => i.id)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  async function handleApply() {
    if (selected.size === 0) return
    setApplying(true)
    setResult(null)
    try {
      const r = await applyRenames('movies', [...selected])
      setResult(r.errors.length > 0
        ? `${r.renamed} renamed, ${r.errors.length} error(s)`
        : r.renamed > 0 ? `${r.renamed} file(s) renamed` : 'Nothing to rename')
      onDone()
      await load()
    } finally {
      setApplying(false)
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

  return (
    <section className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-semibold text-gray-300 hover:text-accent transition-colors"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        Rename &amp; Organize
      </button>

      {open && (
        <div className="bg-surface-raised border border-gray-700 rounded-lg p-4 space-y-3">
          {loading && <p className="text-sm text-gray-500">Loading preview…</p>}

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
                  onClick={handleApply}
                  disabled={applying || selected.size === 0}
                  className="text-xs px-3 py-1.5 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 transition-colors disabled:opacity-40"
                >
                  {applying ? 'Applying…' : `Apply (${selected.size})`}
                </button>
                {result && <span className="text-xs text-gray-400">{result}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

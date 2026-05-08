import { useState, useEffect, useRef } from 'react'
import { fetchRenamePreview, applyRenames } from '../api/files.js'
import type { RenamePreviewItem } from '../api/files.js'

interface Props {
  movie: { id: string; title: string; year: number | null }
  remaining: number
  onApplied: () => void
  onSkip: () => void
  onCancel: () => void
}

export function BatchRenameModal({ movie, remaining, onApplied, onSkip, onCancel }: Props) {
  const [items, setItems] = useState<RenamePreviewItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchRenamePreview('movies', [movie.id])
      .then((all) => setItems(all.filter((i) => i.needsRename)))
      .catch(() => setError('Failed to load rename preview'))
      .finally(() => setLoading(false))
  }, [movie.id])

  async function handleApply() {
    if (!items || items.length === 0) { onSkip(); return }
    setApplying(true)
    setError(null)
    try {
      await applyRenames('movies', items.map((i) => i.id))
      onApplied()
    } catch {
      setError('Rename failed')
      setApplying(false)
    }
  }

  function basename(p: string) {
    return p.split('/').pop() ?? p
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === backdropRef.current) onCancel() }}
    >
      <div className="bg-surface-raised border border-gray-700 rounded-xl w-full max-w-2xl mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div>
            <h2 className="text-base font-semibold text-gray-100">Rename: {movie.title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{remaining} item{remaining !== 1 ? 's' : ''} remaining</p>
          </div>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 min-h-[120px]">
          {loading && <p className="text-sm text-gray-500">Loading preview…</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}

          {!loading && !error && items !== null && items.length === 0 && (
            <p className="text-sm text-gray-500">Files are already canonical — nothing to rename.</p>
          )}

          {!loading && !error && items !== null && items.length > 0 && (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="text-xs font-mono space-y-0.5">
                  <p className="text-gray-400 line-through break-all">{basename(item.currentPath)}</p>
                  <p className="text-green-400 break-all">{basename(item.proposedPath)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-700">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel batch
          </button>
          <button
            onClick={onSkip}
            disabled={applying}
            className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
          >
            Skip
          </button>
          <button
            onClick={handleApply}
            disabled={applying || loading || items?.length === 0}
            className="text-xs px-3 py-1.5 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 transition-colors disabled:opacity-40"
          >
            {applying ? 'Applying…' : items?.length === 0 ? 'Nothing to rename' : `Apply`}
          </button>
        </div>
      </div>
    </div>
  )
}

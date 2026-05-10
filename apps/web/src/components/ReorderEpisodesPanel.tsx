import { useState, useMemo } from 'react'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { EpisodeDetail } from '../api/types.js'
import { reorderEpisodes } from '../api/shows.js'
import { useToast } from '../context/ToastContext.js'

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <circle cx="4.5" cy="4" r="1.2" />
      <circle cx="9.5" cy="4" r="1.2" />
      <circle cx="4.5" cy="7" r="1.2" />
      <circle cx="9.5" cy="7" r="1.2" />
      <circle cx="4.5" cy="10" r="1.2" />
      <circle cx="9.5" cy="10" r="1.2" />
    </svg>
  )
}

interface RowProps {
  ep: EpisodeDetail
  slotNumber: number
  isOriginal: boolean
}

function SortableRow({ ep, slotNumber, isOriginal }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ep.id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const fileName = ep.files[0]?.path.split('/').pop() ?? ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-3 py-2 rounded border text-sm select-none ${
        isDragging
          ? 'bg-gray-700 border-accent/60 shadow-lg z-50'
          : !isOriginal
          ? 'bg-yellow-900/20 border-yellow-700/40'
          : 'bg-surface-raised border-gray-700'
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing flex-shrink-0 p-0.5 text-gray-600 hover:text-gray-400"
        tabIndex={-1}
      >
        <GripIcon />
      </button>

      {/* Slot number (target) */}
      <span className="text-xs font-mono text-gray-400 w-7 flex-shrink-0">
        {String(slotNumber).padStart(2, '0')}
      </span>

      {/* Source indicator when moved */}
      {!isOriginal && (
        <span className="text-xs font-mono text-yellow-500 flex-shrink-0">
          ← {String(ep.episodeNumber).padStart(2, '0')}
        </span>
      )}

      {/* Title */}
      <span className="flex-1 min-w-0 text-gray-200 truncate">
        {ep.title ?? `Episode ${ep.episodeNumber}`}
      </span>

      {/* Current filename */}
      <span className="text-xs text-gray-600 font-mono truncate max-w-xs hidden sm:block" title={ep.files[0]?.path}>
        {fileName}
      </span>
    </div>
  )
}

interface Props {
  showId: string
  seasonNumber: number
  episodes: EpisodeDetail[]
  onDone: () => void
}

export function ReorderEpisodesPanel({ showId, seasonNumber, episodes, onDone }: Props) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [applying, setApplying] = useState(false)

  const ownedEps = useMemo(
    () => [...episodes.filter((e) => e.files.length > 0)].sort((a, b) => a.episodeNumber - b.episodeNumber),
    [episodes],
  )

  const [order, setOrder] = useState<EpisodeDetail[]>(ownedEps)

  // slotNumbers[i] = the canonical episode number at position i (fixed, based on sorted owned episodes)
  const slotNumbers = useMemo(() => ownedEps.map((e) => e.episodeNumber), [ownedEps])

  const isDirty = order.some((ep, i) => ep.id !== ownedEps[i]?.id)

  function toggleOpen() {
    if (!open) setOrder(ownedEps) // always start fresh
    setOpen((o) => !o)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrder((prev) => {
      const oldIdx = prev.findIndex((e) => e.id === active.id)
      const newIdx = prev.findIndex((e) => e.id === over.id)
      return arrayMove(prev, oldIdx, newIdx)
    })
  }

  async function apply() {
    setApplying(true)
    try {
      const result = await reorderEpisodes(showId, seasonNumber, order.map((e) => e.id))
      if (result.errors.length > 0) {
        result.errors.forEach((e) => toast({ type: 'error', message: e }))
      }
      if (result.renamed > 0) {
        toast({ type: 'success', message: `${result.renamed} file${result.renamed !== 1 ? 's' : ''} reassigned and renamed` })
      }
      setOpen(false)
      onDone()
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Reorder failed' })
    } finally {
      setApplying(false)
    }
  }

  if (ownedEps.length < 2) return null

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={toggleOpen}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-raised hover:bg-gray-700/40 transition-colors text-left"
      >
        <span className="text-sm font-medium text-gray-200">Reorder Episodes</span>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-4 space-y-3 bg-surface border-t border-gray-700">
          <p className="text-xs text-gray-500">
            Drag episodes into the correct order. The left number is the target slot; highlighted rows show source → target.
            Files are renamed via a two-phase tmp rename to avoid collisions.
          </p>

          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={order.map((e) => e.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {order.map((ep, i) => (
                  <SortableRow
                    key={ep.id}
                    ep={ep}
                    slotNumber={slotNumbers[i]!}
                    isOriginal={ep.id === ownedEps[i]?.id}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={apply}
              disabled={applying || !isDirty}
              className="text-sm px-4 py-1.5 rounded bg-accent text-black font-medium hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {applying ? 'Applying…' : 'Apply reorder'}
            </button>
            {isDirty && (
              <button
                onClick={() => setOrder(ownedEps)}
                disabled={applying}
                className="text-xs text-gray-500 hover:text-accent transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

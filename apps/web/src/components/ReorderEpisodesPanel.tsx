import { useState, useMemo } from 'react'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { EpisodeDetail, SeasonDetail } from '../api/types.js'
import { reorderEpisodes, crossReassignEpisodes, fetchShow, fetchSeason } from '../api/shows.js'
import { useToast } from '../context/ToastContext.js'

const ROW_H = 'h-9'

// EpisodeDetail annotated with its season context (needed for flat all-seasons view)
type FlatEpisode = EpisodeDetail & { seasonNumber: number; seasonEpisodeCount: number }

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

function SortableFilenameRow({ ep, isOriginal }: { ep: EpisodeDetail; isOriginal: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ep.id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const hasFile = ep.files.length > 0
  const fileName = ep.files[0]?.path.split('/').pop() ?? ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${ROW_H} flex items-center gap-2 px-2 rounded border select-none ${
        isDragging
          ? 'bg-gray-700 border-accent/60 shadow-lg z-50 opacity-90'
          : !isOriginal
          ? 'bg-yellow-900/20 border-yellow-700/40'
          : hasFile
          ? 'bg-surface-raised border-gray-700'
          : 'bg-transparent border-gray-800'
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing flex-shrink-0 p-0.5 text-gray-700 hover:text-gray-500"
        tabIndex={-1}
      >
        <GripIcon />
      </button>
      {hasFile ? (
        <span
          className="flex-1 min-w-0 text-xs text-gray-400 font-mono overflow-hidden whitespace-nowrap"
          style={{ direction: 'rtl', textOverflow: 'ellipsis' }}
          title={ep.files[0]?.path}
        >
          {fileName}
        </span>
      ) : (
        <span className="flex-1 text-xs text-gray-700 italic">— missing —</span>
      )}
    </div>
  )
}

function pad(n: number) { return String(n).padStart(2, '0') }

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

  // ── Single-season state ──────────────────────────────────────────────────
  const allEps = useMemo(
    () => [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber),
    [episodes],
  )
  const ownedCount = allEps.filter((e) => e.files.length > 0).length
  const [order, setOrder] = useState<EpisodeDetail[]>(allEps)
  const isDirty = order.some((ep, i) => ep.id !== allEps[i]?.id)

  // ── All-seasons flat state ───────────────────────────────────────────────
  const [showAll, setShowAll] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)
  const [flatSlots, setFlatSlots] = useState<FlatEpisode[]>([])
  const [flatOrder, setFlatOrder] = useState<FlatEpisode[]>([])
  const isFlatDirty = flatOrder.some((ep, i) => ep.id !== flatSlots[i]?.id)

  function toggleOpen() {
    if (!open) {
      setOrder(allEps)
      setShowAll(false)
    }
    setOpen((o) => !o)
  }

  async function toggleAllSeasons() {
    if (!showAll) {
      setLoadingAll(true)
      try {
        const show = await fetchShow(showId)
        const seasonDetails = await Promise.all(
          show.seasons.map((s) => fetchSeason(showId, s.seasonNumber))
        )
        const flat: FlatEpisode[] = seasonDetails.flatMap((s) =>
          [...s.episodes]
            .sort((a, b) => a.episodeNumber - b.episodeNumber)
            .map((ep) => ({ ...ep, seasonNumber: s.seasonNumber, seasonEpisodeCount: s.episodeCount }))
        )
        setFlatSlots(flat)
        setFlatOrder(flat)
      } catch {
        toast({ type: 'error', message: 'Failed to load all seasons' })
        setLoadingAll(false)
        return
      }
      setLoadingAll(false)
    }
    setShowAll((v) => !v)
  }

  // ── Drag handlers ────────────────────────────────────────────────────────
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrder((prev) => {
      const oldIdx = prev.findIndex((e) => e.id === active.id)
      const newIdx = prev.findIndex((e) => e.id === over.id)
      return arrayMove(prev, oldIdx, newIdx)
    })
  }

  function handleFlatDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setFlatOrder((prev) => {
      const oldIdx = prev.findIndex((e) => e.id === active.id)
      const newIdx = prev.findIndex((e) => e.id === over.id)
      return arrayMove(prev, oldIdx, newIdx)
    })
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  async function apply() {
    setApplying(true)
    try {
      const result = await reorderEpisodes(showId, seasonNumber, order.map((e) => e.id))
      if (result.errors.length > 0) result.errors.forEach((e) => toast({ type: 'error', message: e }))
      if (result.renamed > 0) toast({ type: 'success', message: `${result.renamed} file${result.renamed !== 1 ? 's' : ''} reassigned and renamed` })
      setOpen(false)
      onDone()
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Reorder failed' })
    } finally {
      setApplying(false)
    }
  }

  async function applyFlat() {
    const moves = flatSlots
      .map((slot, i) => ({ from: flatOrder[i]!, to: slot }))
      .filter((m) => m.from.id !== m.to.id && m.from.files.length > 0)
      .map((m) => ({ fromEpisodeId: m.from.id, toEpisodeId: m.to.id }))

    if (moves.length === 0) return

    setApplying(true)
    try {
      const result = await crossReassignEpisodes(showId, moves)
      if (result.errors.length > 0) result.errors.forEach((e) => toast({ type: 'error', message: e }))
      if (result.renamed > 0) toast({ type: 'success', message: `${result.renamed} file${result.renamed !== 1 ? 's' : ''} reassigned and renamed` })
      setOpen(false)
      onDone()
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Reorder failed' })
    } finally {
      setApplying(false)
    }
  }

  if (ownedCount < 1 || allEps.length < 2) return null

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
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {showAll
                ? 'Drag files (right) to any episode slot across all seasons.'
                : 'Titles (left) are fixed TVDB metadata. Drag filenames (right) until each matches its title.'}
            </p>
            <button
              onClick={() => void toggleAllSeasons()}
              disabled={loadingAll}
              className={`flex-shrink-0 ml-4 text-xs px-2.5 py-1 rounded border transition-colors ${
                showAll
                  ? 'border-accent/60 text-accent bg-accent/10'
                  : 'border-gray-600 text-gray-400 hover:border-accent/60 hover:text-accent'
              } disabled:opacity-40`}
            >
              {loadingAll ? 'Loading…' : 'All seasons'}
            </button>
          </div>

          {showAll ? (
            /* ── Flat all-seasons cross-season drag ── */
            <div className="flex gap-2">
              {/* Left: fixed slots with season change indicators */}
              <div className="flex-1 space-y-1">
                {flatSlots.map((slot, i) => {
                  const isNewSeason = i === 0 || slot.seasonNumber !== flatSlots[i - 1]!.seasonNumber
                  const oor = slot.seasonEpisodeCount > 0 && slot.episodeNumber > slot.seasonEpisodeCount
                  return (
                    <div
                      key={slot.id}
                      className={`${ROW_H} flex items-center gap-1 px-2 ${isNewSeason && i > 0 ? 'border-t border-gray-700/50 mt-0.5' : ''} ${oor ? 'rounded bg-yellow-900/20' : ''}`}
                    >
                      <span className="text-xs font-mono w-12 flex-shrink-0 text-gray-600">
                        {isNewSeason ? `S${pad(slot.seasonNumber)}` : ''}{isNewSeason ? '' : ''}E{pad(slot.episodeNumber)}
                      </span>
                      <span className={`text-sm truncate ${oor ? 'text-yellow-400' : slot.files.length > 0 ? 'text-gray-200' : 'text-gray-600 italic'}`}>
                        {oor ? `⚠ E${slot.episodeNumber} not in TVDB` : (slot.title ?? `Episode ${slot.episodeNumber}`)}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Right: flat draggable list spanning all seasons */}
              <DndContext collisionDetection={closestCenter} onDragEnd={handleFlatDragEnd}>
                <SortableContext items={flatOrder.map((e) => e.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex-[2] space-y-1">
                    {flatOrder.map((ep, i) => (
                      <SortableFilenameRow
                        key={ep.id}
                        ep={ep}
                        isOriginal={ep.id === flatSlots[i]?.id}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          ) : (
            /* ── Single-season drag ── */
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                {allEps.map((ep) => (
                  <div key={ep.id} className={`${ROW_H} flex items-center gap-2 px-3`}>
                    <span className="text-xs font-mono text-gray-500 w-7 flex-shrink-0">
                      {pad(ep.episodeNumber)}
                    </span>
                    <span className={`text-sm truncate ${ep.files.length > 0 ? 'text-gray-200' : 'text-gray-600 italic'}`}>
                      {ep.title ?? `Episode ${ep.episodeNumber}`}
                    </span>
                  </div>
                ))}
              </div>
              <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={order.map((e) => e.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex-[2] space-y-1">
                    {order.map((ep, i) => (
                      <SortableFilenameRow
                        key={ep.id}
                        ep={ep}
                        isOriginal={ep.id === allEps[i]?.id}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => void (showAll ? applyFlat() : apply())}
              disabled={applying || (showAll ? !isFlatDirty : !isDirty)}
              className="text-sm px-4 py-1.5 rounded bg-accent text-black font-medium hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {applying ? 'Applying…' : 'Apply reorder'}
            </button>
            {!showAll && isDirty && (
              <button
                onClick={() => setOrder(allEps)}
                disabled={applying}
                className="text-xs text-gray-500 hover:text-accent transition-colors"
              >
                Reset
              </button>
            )}
            {showAll && isFlatDirty && (
              <button
                onClick={() => setFlatOrder(flatSlots)}
                disabled={applying}
                className="text-xs text-gray-500 hover:text-accent transition-colors"
              >
                Reset all
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

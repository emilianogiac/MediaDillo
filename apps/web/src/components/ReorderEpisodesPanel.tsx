import { useState, useMemo } from 'react'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { EpisodeDetail, SeasonDetail } from '../api/types.js'
import { reorderEpisodes, fetchShow, fetchSeason } from '../api/shows.js'
import { useToast } from '../context/ToastContext.js'

const ROW_H = 'h-9'

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
  const haFile = ep.files.length > 0
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
          : haFile
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
      {haFile ? (
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

interface SeasonBlockProps {
  showId: string
  seasonData: SeasonDetail
  order: EpisodeDetail[]
  original: EpisodeDetail[]
  onDragEnd: (seasonNumber: number, event: DragEndEvent) => void
  onReset: (seasonNumber: number) => void
}

function SeasonBlock({ seasonData, order, original, onDragEnd, onReset }: SeasonBlockProps) {
  const isDirty = order.some((ep, i) => ep.id !== original[i]?.id)
  // Episodes whose number exceeds TVDB's known count are mis-tagged and can't be placed into a valid slot.
  const knownCount = seasonData.episodeCount
  const isOutOfRange = (ep: EpisodeDetail) => knownCount > 0 && ep.episodeNumber > knownCount

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Season {seasonData.seasonNumber}
        </span>
        {isDirty && (
          <button
            onClick={() => onReset(seasonData.seasonNumber)}
            className="text-xs text-gray-600 hover:text-accent transition-colors"
          >
            Reset
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          {original.map((ep) => {
            const oor = isOutOfRange(ep)
            return (
              <div key={ep.id} className={`${ROW_H} flex items-center gap-2 px-3 ${oor ? 'rounded border border-yellow-700/40 bg-yellow-900/20' : ''}`}>
                <span className={`text-xs font-mono w-7 flex-shrink-0 ${oor ? 'text-yellow-500' : 'text-gray-500'}`}>
                  {String(ep.episodeNumber).padStart(2, '0')}
                </span>
                <span className={`text-sm truncate ${oor ? 'text-yellow-400' : ep.files.length > 0 ? 'text-gray-200' : 'text-gray-600 italic'}`}>
                  {oor ? `⚠ E${ep.episodeNumber} not in TVDB (${knownCount} episodes)` : (ep.title ?? `Episode ${ep.episodeNumber}`)}
                </span>
              </div>
            )
          })}
        </div>
        <DndContext collisionDetection={closestCenter} onDragEnd={(e) => onDragEnd(seasonData.seasonNumber, e)}>
          <SortableContext items={order.map((e) => e.id)} strategy={verticalListSortingStrategy}>
            <div className="flex-[2] space-y-1">
              {order.map((ep, i) => (
                <SortableFilenameRow
                  key={ep.id}
                  ep={ep}
                  isOriginal={ep.id === original[i]?.id}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
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
  const [showAll, setShowAll] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)
  const [allSeasons, setAllSeasons] = useState<SeasonDetail[] | null>(null)
  const [allOrder, setAllOrder] = useState<Map<number, EpisodeDetail[]>>(new Map())

  const allEps = useMemo(
    () => [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber),
    [episodes],
  )
  const ownedCount = allEps.filter((e) => e.files.length > 0).length

  const [order, setOrder] = useState<EpisodeDetail[]>(allEps)
  const isDirty = order.some((ep, i) => ep.id !== allEps[i]?.id)
  const isAllDirty = allSeasons !== null && allSeasons.some((s) => {
    const sorted = [...s.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)
    const cur = allOrder.get(s.seasonNumber) ?? sorted
    return cur.some((ep, i) => ep.id !== sorted[i]?.id)
  })

  function toggleOpen() {
    if (!open) {
      setOrder(allEps)
      setShowAll(false)
    }
    setOpen((o) => !o)
  }

  async function toggleAllSeasons() {
    if (!showAll && allSeasons === null) {
      setLoadingAll(true)
      try {
        const show = await fetchShow(showId)
        const seasons = await Promise.all(
          show.seasons.map((s) => fetchSeason(showId, s.seasonNumber))
        )
        const initOrder = new Map<number, EpisodeDetail[]>()
        for (const s of seasons) {
          initOrder.set(s.seasonNumber, [...s.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber))
        }
        setAllSeasons(seasons)
        setAllOrder(initOrder)
      } catch {
        toast({ type: 'error', message: 'Failed to load all seasons' })
        setLoadingAll(false)
        return
      }
      setLoadingAll(false)
    }
    setShowAll((v) => !v)
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

  function handleAllDragEnd(sn: number, event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setAllOrder((prev) => {
      const cur = prev.get(sn) ?? []
      const oldIdx = cur.findIndex((e) => e.id === active.id)
      const newIdx = cur.findIndex((e) => e.id === over.id)
      const next = new Map(prev)
      next.set(sn, arrayMove(cur, oldIdx, newIdx))
      return next
    })
  }

  function resetSeason(sn: number) {
    if (!allSeasons) return
    const s = allSeasons.find((x) => x.seasonNumber === sn)
    if (!s) return
    const sorted = [...s.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)
    setAllOrder((prev) => { const next = new Map(prev); next.set(sn, sorted); return next })
  }

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

  async function applyAll() {
    if (!allSeasons) return
    setApplying(true)
    let totalRenamed = 0
    const errors: string[] = []

    for (const s of allSeasons) {
      const sorted = [...s.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)
      const cur = allOrder.get(s.seasonNumber) ?? sorted
      const dirty = cur.some((ep, i) => ep.id !== sorted[i]?.id)
      if (!dirty) continue
      try {
        const result = await reorderEpisodes(showId, s.seasonNumber, cur.map((e) => e.id))
        totalRenamed += result.renamed
        errors.push(...result.errors)
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Season ${s.seasonNumber} reorder failed`)
      }
    }

    if (errors.length > 0) errors.forEach((e) => toast({ type: 'error', message: e }))
    if (totalRenamed > 0) toast({ type: 'success', message: `${totalRenamed} file${totalRenamed !== 1 ? 's' : ''} reassigned and renamed` })
    setOpen(false)
    onDone()
    setApplying(false)
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
              Titles (left) are fixed TMDB metadata. Drag filenames (right) until each matches its title.
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

          {showAll && allSeasons ? (
            <div className="space-y-6">
              {allSeasons.filter((s) => s.episodes.some((e) => e.files.length > 0)).map((s) => {
                const sorted = [...s.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)
                const cur = allOrder.get(s.seasonNumber) ?? sorted
                return (
                  <SeasonBlock
                    key={s.seasonNumber}
                    showId={showId}
                    seasonData={s}
                    order={cur}
                    original={sorted}
                    onDragEnd={handleAllDragEnd}
                    onReset={resetSeason}
                  />
                )
              })}
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                {allEps.map((ep) => (
                  <div key={ep.id} className={`${ROW_H} flex items-center gap-2 px-3`}>
                    <span className="text-xs font-mono text-gray-500 w-7 flex-shrink-0">
                      {String(ep.episodeNumber).padStart(2, '0')}
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
            {showAll ? (
              <>
                <button
                  onClick={() => void applyAll()}
                  disabled={applying || !isAllDirty}
                  className="text-sm px-4 py-1.5 rounded bg-accent text-black font-medium hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {applying ? 'Applying…' : 'Apply reorder'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => void apply()}
                  disabled={applying || !isDirty}
                  className="text-sm px-4 py-1.5 rounded bg-accent text-black font-medium hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {applying ? 'Applying…' : 'Apply reorder'}
                </button>
                {isDirty && (
                  <button
                    onClick={() => setOrder(allEps)}
                    disabled={applying}
                    className="text-xs text-gray-500 hover:text-accent transition-colors"
                  >
                    Reset
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { MovieDetail, MovieFile } from '../api/types.js'
import { fetchMovie, fetchMovies, triggerMovieDownload, fetchMovieImages, selectMovieImage, fetchMovieCandidates, matchMovie, deleteMovie, deleteMovieWithFiles, deleteMovieFileSingle, consolidateMovie, replaceMovieFiles, dismissDuplicate, undismissDuplicate, rescanMovie, setMovieFileOrder, moveMovie, updateFileEdition, updateFileThreeD, fetchEditions, renameEdition, fetchMovieFolderScan, updateMovieMetadata } from '../api/movies.js'
import { fetchScanRoots } from '../api/movies.js'
import type { ScanRoot, MovieSummary } from '../api/types.js'
import { TechBadge } from '../components/TechBadge.js'
import { ArtworkManager } from '../components/ArtworkManager.js'
import { MatchModal } from '../components/MatchModal.js'
import { MovieFilesPanel } from '../components/MovieFilesPanel.js'
import { MovieFolderCleanupPanel } from '../components/MovieFolderCleanupPanel.js'
import { useToast } from '../context/ToastContext.js'
import { fetchJellyfinStatus, fetchJellyfinMovieUrl } from '../api/jellyfin.js'
import { ConfirmModal } from '../components/ConfirmModal.js'

function formatSize(bytes: number | null): string {
  if (!bytes) return '—'
  const gb = bytes / 1_073_741_824
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1_048_576).toFixed(0)} MB`
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
      <circle cx="3" cy="4" r="1.5" /><circle cx="7" cy="4" r="1.5" />
      <circle cx="3" cy="8" r="1.5" /><circle cx="7" cy="8" r="1.5" />
      <circle cx="3" cy="12" r="1.5" /><circle cx="7" cy="12" r="1.5" />
    </svg>
  )
}

const THREE_D_OPTIONS = [
  { value: null, label: 'None' },
  { value: 'sbs', label: '3D SBS' },
  { value: 'ou', label: '3D OU' },
  { value: 'full_sbs', label: '3D Full-SBS' },
  { value: 'unknown', label: '3D (unknown)' },
] as const

const THREE_D_BADGE: Record<string, string> = {
  sbs: '3D · SBS',
  ou: '3D · OU',
  full_sbs: '3D · Full-SBS',
  unknown: '3D',
}

interface FileCardHandlers {
  openEditionPicker: (fileId: string, current: string) => void
  closeEditionPicker: () => void
  setEditionInput: (v: string) => void
  saveEdition: (fileId: string) => void
  setEditingGlobalEdition: (ed: string | null) => void
  setGlobalRenameInput: (v: string) => void
  globalRename: (from: string) => void
  openThreeDPicker: (fileId: string) => void
  setThreeD: (fileId: string, value: string | null) => void
  deleteFile?: (fileId: string) => void
}

interface SortableFileCardProps {
  file: MovieFile
  partLabel: string | null
  totalFiles: number
  editingEditionFileId: string | null
  editionInput: string
  savingEdition: boolean
  editions: string[]
  editingGlobalEdition: string | null
  globalRenameInput: string
  renamingGlobal: boolean
  threeDPickerFileId: string | null
  handlers: FileCardHandlers
}

function SortableFileCard({
  file, partLabel, totalFiles,
  editingEditionFileId, editionInput, savingEdition, editions,
  editingGlobalEdition, globalRenameInput, renamingGlobal,
  threeDPickerFileId, handlers,
}: SortableFileCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: file.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  const qualityTier = file.videoQualityTier
  const isEditing = editingEditionFileId === file.id
  const isThreeDPicker = threeDPickerFileId === file.id

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-surface-raised border border-gray-700 rounded-lg px-4 py-3 space-y-2 ${isDragging ? 'opacity-50 shadow-2xl' : ''}`}
    >
      <div className="flex items-center gap-2">
        {/* Drag handle */}
        {totalFiles > 1 && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 shrink-0 touch-none"
            title="Drag to reorder"
          >
            <GripIcon />
          </button>
        )}

        {/* Edition badge / label */}
        {!isEditing && file.edition ? (
          <button
            onClick={() => handlers.openEditionPicker(file.id, file.edition ?? '')}
            className="flex items-center gap-1 group shrink-0"
            title="Edit edition"
          >
            <TechBadge label={file.edition} variant="edition" />
            <span className="text-gray-600 group-hover:text-gray-400 text-xs">✎</span>
          </button>
        ) : !isEditing && partLabel ? (
          <span className="text-xs text-gray-500 font-mono w-12 shrink-0">{partLabel}</span>
        ) : null}
        {!isEditing && !file.edition && (
          <button
            onClick={() => handlers.openEditionPicker(file.id, '')}
            className="text-xs px-1.5 py-0.5 rounded border border-dashed border-gray-700 text-gray-500 hover:border-teal-600/60 hover:text-teal-400 transition-colors shrink-0"
            title="Set edition label"
          >
            ＋ edition
          </button>
        )}

        <p className="text-xs text-gray-400 font-mono break-all flex-1">{file.path}</p>
      </div>

      {/* Edition picker panel */}
      {isEditing && (
        <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={editionInput}
              onChange={(e) => handlers.setEditionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlers.saveEdition(file.id)
                if (e.key === 'Escape') handlers.closeEditionPicker()
              }}
              placeholder="e.g. Director's Cut"
              className="flex-1 bg-gray-800 border border-accent/60 rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-600 focus:outline-none"
            />
            <button onClick={() => handlers.saveEdition(file.id)} disabled={savingEdition} className="text-xs px-2.5 py-1 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 disabled:opacity-40 transition-colors">
              {savingEdition ? 'Saving…' : 'Save'}
            </button>
            <button onClick={handlers.closeEditionPicker} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
          </div>

          {editions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">Existing editions — click to reuse, ✎ to rename globally:</p>
              <div className="flex flex-wrap gap-1.5">
                {editions.map((ed) => (
                  <div key={ed} className="flex items-center gap-0.5">
                    <button
                      onClick={() => handlers.setEditionInput(ed)}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${editionInput === ed ? 'bg-teal-700/60 border-teal-500/60 text-teal-100' : 'bg-teal-900/30 border-teal-700/40 text-teal-300 hover:bg-teal-800/50'}`}
                    >
                      {ed}
                    </button>
                    <button
                      onClick={() => { handlers.setEditingGlobalEdition(ed); handlers.setGlobalRenameInput(ed) }}
                      title={`Rename "${ed}" on all movies`}
                      className="text-xs text-gray-600 hover:text-gray-300 px-0.5 transition-colors"
                    >
                      ✎
                    </button>
                  </div>
                ))}
              </div>

              {editingGlobalEdition && (
                <div className="border-t border-gray-700 pt-2 space-y-1.5">
                  <p className="text-xs text-gray-400">Rename <span className="text-teal-300">"{editingGlobalEdition}"</span> across all movies:</p>
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={globalRenameInput}
                      onChange={(e) => handlers.setGlobalRenameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handlers.globalRename(editingGlobalEdition)
                        if (e.key === 'Escape') { handlers.setEditingGlobalEdition(null); handlers.setGlobalRenameInput('') }
                      }}
                      placeholder="New edition name…"
                      className="flex-1 bg-gray-800 border border-teal-700/60 rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-600 focus:outline-none"
                    />
                    <button
                      onClick={() => handlers.globalRename(editingGlobalEdition)}
                      disabled={renamingGlobal || !globalRenameInput.trim()}
                      className="text-xs px-2.5 py-1 rounded bg-teal-800/40 border border-teal-600/40 text-teal-200 hover:bg-teal-700/50 disabled:opacity-40 transition-colors"
                    >
                      {renamingGlobal ? 'Renaming…' : 'Rename all'}
                    </button>
                    <button onClick={() => { handlers.setEditingGlobalEdition(null); handlers.setGlobalRenameInput('') }} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 items-center">
        {qualityTier && <TechBadge label={qualityTier} variant="quality" />}
        {file.hdr && <TechBadge label="HDR" variant="hdr" />}
        {/* 3D badge — click to open picker */}
        {file.threeD ? (
          <button
            onClick={() => handlers.openThreeDPicker(file.id)}
            className="flex items-center gap-1 group shrink-0"
            title="Change 3D format"
          >
            <TechBadge label={THREE_D_BADGE[file.threeD] ?? '3D'} variant="hdr" />
            <span className="text-gray-600 group-hover:text-gray-400 text-xs">✎</span>
          </button>
        ) : (
          <button
            onClick={() => handlers.openThreeDPicker(file.id)}
            className="text-xs px-1.5 py-0.5 rounded border border-dashed border-gray-700 text-gray-500 hover:border-teal-600/60 hover:text-teal-400 transition-colors shrink-0"
            title="Mark as 3D"
          >
            ＋ 3D
          </button>
        )}
        {file.videoCodec && <TechBadge label={file.videoCodec} />}
        {file.audioCodec && <TechBadge label={file.audioCodec} />}
        {file.audioChannels && <TechBadge label={file.audioChannels} />}
        {file.audioQualityTier && <TechBadge label={file.audioQualityTier} />}
        <span className="text-xs text-gray-500 ml-auto">
          {formatSize(Number(file.sizeBytes))}
          {file.durationS ? ` · ${formatDuration(file.durationS)}` : ''}
        </span>
      </div>

      {/* 3D format picker */}
      {isThreeDPicker && (
        <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-2">Select 3D format</p>
          <div className="flex flex-wrap gap-2">
            {THREE_D_OPTIONS.map((opt) => (
              <button
                key={opt.value ?? 'none'}
                onClick={() => handlers.setThreeD(file.id, opt.value ?? null)}
                className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                  file.threeD === opt.value
                    ? 'bg-teal-900/40 border-teal-600/60 text-teal-300'
                    : 'border-gray-700 text-gray-400 hover:border-teal-600/40 hover:text-teal-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {handlers.deleteFile && (
        <div className="flex justify-end pt-1 border-t border-gray-700/50">
          <button
            onClick={() => handlers.deleteFile!(file.id)}
            className="text-xs px-2.5 py-1 rounded border border-red-700/40 text-red-500 hover:bg-red-700/20 transition-colors"
          >
            Delete from disk
          </button>
        </div>
      )}
    </div>
  )
}

export function MovieDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { toast } = useToast()

  // Build the back URL using the search params passed as location state from the movies list.
  // Falls back to /movies with no filters when navigating directly to a detail URL.
  const backToMovies = `/movies${(location.state as { from?: string } | null)?.from ?? ''}`
  const [movie, setMovie] = useState<MovieDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMatchModal, setShowMatchModal] = useState(false)
  const [rematching, setRematching] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePreview, setDeletePreview] = useState<{ folderPath: string; files: import('../api/movies.js').FolderFile[] } | null>(null)
  const [deletingWithFiles, setDeletingWithFiles] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [rescanResult, setRescanResult] = useState<string | null>(null)
  const [fileOrder, setFileOrder] = useState<MovieFile[]>([])
  const [savingOrder, setSavingOrder] = useState(false)
  const [scanRoots, setScanRoots] = useState<ScanRoot[]>([])
  const [moving, setMoving] = useState(false)
  const [moveTarget, setMoveTarget] = useState('')
  const [artworkVersion, setArtworkVersion] = useState(() => Date.now())
  const [cleanupTrigger, setCleanupTrigger] = useState(0)
  const [editingEditionFileId, setEditingEditionFileId] = useState<string | null>(null)
  const [editionInput, setEditionInput] = useState('')
  const [savingEdition, setSavingEdition] = useState(false)
  const [threeDPickerFileId, setThreeDPickerFileId] = useState<string | null>(null)
  const [editions, setEditions] = useState<string[]>([])
  const [editingGlobalEdition, setEditingGlobalEdition] = useState<string | null>(null)
  const [globalRenameInput, setGlobalRenameInput] = useState('')
  const [renamingGlobal, setRenamingGlobal] = useState(false)
  const [siblings, setSiblings] = useState<MovieSummary[]>([])
  const [deletingSiblingId, setDeletingSiblingId] = useState<string | null>(null)
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null)
  const [consolidateTarget, setConsolidateTarget] = useState<MovieSummary | null>(null)
  const [consolidating, setConsolidating] = useState(false)
  const [replaceTarget, setReplaceTarget] = useState<MovieSummary | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [editField, setEditField] = useState<'title' | 'year' | 'tagline' | 'overview' | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingField, setSavingField] = useState(false)
  const [jellyfinConfigured, setJellyfinConfigured] = useState(false)
  const [openingJellyfin, setOpeningJellyfin] = useState(false)
  const [movieRenameCount, setMovieRenameCount] = useState<number | null>(null)
  const [movieCleanupCount, setMovieCleanupCount] = useState<number | null>(null)

  function handleDelete() {
    if (!id) return
    setConfirm({
      title: 'Remove record',
      message: 'Remove this movie from the database? Files on disk are not affected.',
      onConfirm: async () => {
        setConfirm(null)
        setDeleting(true)
        try {
          await deleteMovie(id)
          navigate(backToMovies, { replace: true })
        } catch {
          setDeleting(false)
        }
      },
    })
  }

  async function openDeleteWithFilesModal() {
    if (!id) return
    try {
      const scan = await fetchMovieFolderScan(id)
      setDeletePreview(scan)
      setShowDeleteModal(true)
    } catch {
      toast({ type: 'error', message: 'Could not read folder contents' })
    }
  }

  async function confirmDeleteWithFiles() {
    if (!id) return
    setDeletingWithFiles(true)
    try {
      const { deleted } = await deleteMovieWithFiles(id)
      toast({ type: 'success', message: `Deleted ${deleted} file${deleted !== 1 ? 's' : ''} from disk` })
      navigate(backToMovies, { replace: true })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Delete failed' })
      setDeletingWithFiles(false)
    }
  }

  const load = useCallback(() => {
    if (!id) return Promise.resolve()
    setLoading(true)
    return fetchMovie(id)
      .then((m) => { setMovie(m); setFileOrder(m.files) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [id])

  async function handleRescan() {
    if (!id) return
    setRescanning(true)
    setRescanResult(null)
    try {
      const r = await rescanMovie(id)
      const parts = [r.added > 0 && `${r.added} added`, r.changed > 0 && `${r.changed} changed`, r.removed > 0 && `${r.removed} removed`].filter(Boolean)
      setRescanResult(parts.length > 0 ? parts.join(', ') : 'Up to date')
      setCleanupTrigger((n) => n + 1)
    } catch {
      setRescanResult('Rescan failed')
      toast({ type: 'error', message: 'Rescan failed' })
    } finally {
      setRescanning(false)
      load()
    }
  }

  async function handleRematch() {
    if (!id || !movie?.tmdbId) return
    setRematching(true)
    try {
      await matchMovie(id, movie.tmdbId)
      await load()
      setArtworkVersion(Date.now())
      toast({ type: 'success', message: 'Metadata refreshed from TMDB' })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Rematch failed' })
    } finally {
      setRematching(false)
    }
  }

  async function handleSaveEdition(fileId: string) {
    setSavingEdition(true)
    try {
      await updateFileEdition(fileId, editionInput.trim() || null)
      load()
      fetchEditions().then(setEditions).catch(() => {})
      toast({ type: 'success', message: 'Edition updated' })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to save edition' })
    } finally {
      setSavingEdition(false)
      setEditingEditionFileId(null)
      setEditionInput('')
      setEditingGlobalEdition(null)
      setGlobalRenameInput('')
    }
  }

  function openEditionPicker(fileId: string, currentEdition: string) {
    setEditingEditionFileId(fileId)
    setEditionInput(currentEdition)
    setEditingGlobalEdition(null)
    setGlobalRenameInput('')
    fetchEditions().then(setEditions).catch(() => {})
  }

  function closeEditionPicker() {
    setEditingEditionFileId(null)
    setEditionInput('')
    setEditingGlobalEdition(null)
    setGlobalRenameInput('')
  }

  async function handleGlobalRename(from: string) {
    const to = globalRenameInput.trim() || null
    if (to === from) { setEditingGlobalEdition(null); return }
    setRenamingGlobal(true)
    try {
      const r = await renameEdition(from, to)
      load()
      const fresh = await fetchEditions()
      setEditions(fresh)
      setEditingGlobalEdition(null)
      setGlobalRenameInput('')
      if (editionInput === from) setEditionInput(to ?? '')
      toast({ type: 'success', message: `Renamed "${from}" on ${r.updated} file${r.updated !== 1 ? 's' : ''}` })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Rename failed' })
    } finally {
      setRenamingGlobal(false)
    }
  }

  function openThreeDPicker(fileId: string) {
    setThreeDPickerFileId((prev) => prev === fileId ? null : fileId)
  }

  async function handleSetThreeD(fileId: string, value: string | null) {
    setThreeDPickerFileId(null)
    try {
      await updateFileThreeD(fileId, value)
      load()
    } catch {
      toast({ type: 'error', message: 'Failed to update 3D format' })
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setFileOrder((items) => {
      const oldIdx = items.findIndex((f) => f.id === String(active.id))
      const newIdx = items.findIndex((f) => f.id === String(over.id))
      return arrayMove(items, oldIdx, newIdx)
    })
  }

  async function handleSaveOrder() {
    if (!id) return
    setSavingOrder(true)
    try {
      await setMovieFileOrder(id, fileOrder.map((f) => f.id))
      load()
    } finally {
      setSavingOrder(false)
    }
  }

  async function handleMove() {
    if (!id || !moveTarget) return
    setMoving(true)
    try {
      await moveMovie(id, moveTarget)
      load()
      setMoveTarget('')
    } catch {
      // error visible via load failure
    } finally {
      setMoving(false)
    }
  }

  async function handleSaveField() {
    if (!id || !editField) return
    setSavingField(true)
    try {
      const trimmed = editValue.trim()
      const data: Parameters<typeof updateMovieMetadata>[1] =
        editField === 'title' ? { ...(trimmed ? { title: trimmed } : {}) }
        : editField === 'year' ? { year: editValue ? parseInt(editValue) : null }
        : editField === 'tagline' ? { tagline: trimmed || null }
        : { overview: trimmed || null }
      await updateMovieMetadata(id, data)
      await load()
      setEditField(null)
      setEditValue('')
      toast({ type: 'success', message: 'Metadata updated' })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Save failed' })
    } finally {
      setSavingField(false)
    }
  }

  function startEdit(field: typeof editField, current: string) {
    setEditField(field)
    setEditValue(current)
  }

  function handleDeleteFileSingle(fileId: string) {
    const file = fileOrder.find((f) => f.id === fileId)
    const name = file?.path.split('/').pop() ?? 'this file'
    setConfirm({
      title: 'Delete file from disk',
      message: `Permanently delete "${name}"? This cannot be undone.`,
      onConfirm: async () => {
        setConfirm(null)
        setDeletingFileId(fileId)
        try {
          await deleteMovieFileSingle(fileId)
          toast({ type: 'success', message: 'File deleted from disk' })
          load()
        } catch (e) {
          toast({ type: 'error', message: e instanceof Error ? e.message : 'Delete failed' })
        } finally {
          setDeletingFileId(null)
        }
      },
    })
  }

  async function handleConsolidate() {
    if (!consolidateTarget || !id) return
    setConsolidating(true)
    try {
      const r = await consolidateMovie(id, consolidateTarget.id)
      toast({ type: 'success', message: `Consolidated ${r.consolidated} file${r.consolidated !== 1 ? 's' : ''} into this collection` })
      setConsolidateTarget(null)
      setSiblings((prev) => prev.filter((s) => s.id !== consolidateTarget.id))
      load()
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Consolidate failed' })
    } finally {
      setConsolidating(false)
    }
  }

  async function handleReplace() {
    if (!replaceTarget || !id) return
    setReplacing(true)
    try {
      const r = await replaceMovieFiles(id, replaceTarget.id)
      toast({ type: 'success', message: `Replaced with ${r.replaced} file${r.replaced !== 1 ? 's' : ''} from ${replaceTarget.scanRoot?.label ?? 'the other collection'}` })
      setReplaceTarget(null)
      setSiblings((prev) => prev.filter((s) => s.id !== replaceTarget.id))
      load()
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Replace failed' })
    } finally {
      setReplacing(false)
    }
  }

  async function handleDismiss(siblingId: string) {
    setDismissingId(siblingId)
    try {
      await dismissDuplicate(siblingId)
      setSiblings((prev) => prev.map((s) => s.id === siblingId ? { ...s, dismissedAsDuplicate: true } : s))
      toast({ type: 'success', message: 'Marked as intentional duplicate' })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Dismiss failed' })
    } finally {
      setDismissingId(null)
    }
  }

  async function handleUndismiss(siblingId: string) {
    setDismissingId(siblingId)
    try {
      await undismissDuplicate(siblingId)
      setSiblings((prev) => prev.map((s) => s.id === siblingId ? { ...s, dismissedAsDuplicate: false } : s))
      toast({ type: 'success', message: 'Duplicate warning restored' })
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Undo failed' })
    } finally {
      setDismissingId(null)
    }
  }

  function handleDeleteSibling(siblingId: string) {
    const sibling = siblings.find((s) => s.id === siblingId)
    const label = sibling?.scanRoot?.label ?? 'this copy'
    setConfirm({
      title: 'Delete duplicate copy',
      message: `Permanently delete "${label}" and its files from disk? This cannot be undone.`,
      onConfirm: async () => {
        setConfirm(null)
        setDeletingSiblingId(siblingId)
        try {
          if ((sibling?.fileCount ?? 0) > 0) {
            await deleteMovieWithFiles(siblingId)
          } else {
            await deleteMovie(siblingId)
          }
          setSiblings((prev) => prev.filter((s) => s.id !== siblingId))
          toast({ type: 'success', message: 'Duplicate copy deleted' })
        } catch (e) {
          toast({ type: 'error', message: e instanceof Error ? e.message : 'Delete failed' })
        } finally {
          setDeletingSiblingId(null)
        }
      },
    })
  }

  async function handleOpenInJellyfin() {
    if (!id) return
    setOpeningJellyfin(true)
    try {
      const { url } = await fetchJellyfinMovieUrl(id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      toast({ type: 'error', message: 'Movie not found in Jellyfin — try triggering a library refresh first' })
    } finally {
      setOpeningJellyfin(false)
    }
  }

  useEffect(() => { load() }, [load])
  useEffect(() => { fetchScanRoots().then(setScanRoots).catch(() => {}) }, [])
  useEffect(() => { fetchJellyfinStatus().then((s) => setJellyfinConfigured(s.configured && s.connected)).catch(() => {}) }, [])
  useEffect(() => {
    if (!movie?.tmdbId) { setSiblings([]); return }
    fetchMovies({ tmdbId: movie.tmdbId })
      .then((all) => setSiblings(all.filter((m) => m.id !== movie.id)))
      .catch(() => {})
  }, [movie?.tmdbId, movie?.id])

  if (loading) {
    return <div className="p-6 text-gray-500">Loading…</div>
  }
  if (error || !movie) {
    return (
      <div className="p-6 text-red-400">
        {error ?? 'Movie not found'}
        <button onClick={() => navigate(backToMovies)} className="block mt-2 text-sm text-accent hover:underline">
          ← Back to Movies
        </button>
      </div>
    )
  }

  const directors = movie.credits.filter((c) => c.role === 'director')
  const cast = movie.credits.filter((c) => c.role === 'cast').slice(0, 12)

  return (
    <div className="p-6 space-y-8">
      {/* Back link */}
      <button onClick={() => navigate(backToMovies)} className="text-sm text-gray-400 hover:text-accent transition-colors">
        ← Movies
      </button>

      {/* Hero section */}
      <div className="flex gap-6">
        {/* Poster */}
        <div className="flex-shrink-0 self-start w-36 rounded-lg overflow-hidden bg-gray-800 border border-gray-700">
          {(movie.posterDownloaded || movie.posterUrl) ? (
            <img
              src={movie.posterDownloaded ? `/api/artwork/movies/${movie.id}/poster?v=${artworkVersion}` : movie.posterUrl!}
              alt={movie.title}
              className="w-full object-cover"
            />
          ) : (
            <div className="aspect-[2/3] flex items-center justify-center text-gray-600 text-xs text-center px-2">
              No Poster
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="flex-1 space-y-3">
          <div>
            {editField === 'title' ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveField(); if (e.key === 'Escape') { setEditField(null); setEditValue('') } }}
                  className="flex-1 text-2xl font-bold bg-gray-800 border border-accent/60 rounded px-2 py-0.5 text-gray-100 focus:outline-none"
                />
                <button onClick={() => void handleSaveField()} disabled={savingField} className="text-xs px-2.5 py-1 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 disabled:opacity-40 transition-colors">{savingField ? '…' : 'Save'}</button>
                <button onClick={() => { setEditField(null); setEditValue('') }} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group/title">
                <h1 className="text-3xl font-bold">{movie.title}</h1>
                <button onClick={() => startEdit('title', movie.title)} className="text-gray-600 opacity-0 group-hover/title:opacity-100 hover:text-gray-300 transition-all text-sm" title="Edit title">✎</button>
                {movieRenameCount === 0 && movieCleanupCount === 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 border border-green-700/40 text-green-400">✓ Organized</span>
                )}
              </div>
            )}
            {editField === 'tagline' ? (
              <div className="flex items-center gap-2 mt-0.5">
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveField(); if (e.key === 'Escape') { setEditField(null); setEditValue('') } }}
                  placeholder="Tagline…"
                  className="flex-1 bg-gray-800 border border-accent/60 rounded px-2 py-0.5 text-sm text-gray-300 italic focus:outline-none"
                />
                <button onClick={() => void handleSaveField()} disabled={savingField} className="text-xs px-2.5 py-1 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 disabled:opacity-40 transition-colors">{savingField ? '…' : 'Save'}</button>
                <button onClick={() => { setEditField(null); setEditValue('') }} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-1 group/tag mt-0.5">
                {movie.tagline ? (
                  <p className="text-gray-400 italic">{movie.tagline}</p>
                ) : (
                  <span className="text-gray-600 text-xs italic">No tagline</span>
                )}
                <button onClick={() => startEdit('tagline', movie.tagline ?? '')} className="text-gray-600 opacity-0 group-hover/tag:opacity-100 hover:text-gray-300 transition-all text-xs" title="Edit tagline">✎</button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3 text-sm text-gray-400">
            {editField === 'year' ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  type="number"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveField(); if (e.key === 'Escape') { setEditField(null); setEditValue('') } }}
                  placeholder="Year"
                  className="w-24 bg-gray-800 border border-accent/60 rounded px-2 py-0.5 text-sm text-gray-100 focus:outline-none"
                />
                <button onClick={() => void handleSaveField()} disabled={savingField} className="text-xs px-2.5 py-1 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 disabled:opacity-40 transition-colors">{savingField ? '…' : 'Save'}</button>
                <button onClick={() => { setEditField(null); setEditValue('') }} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
              </div>
            ) : (
              <span className="flex items-center gap-1 group/year">
                {movie.year ?? <span className="text-gray-600">No year</span>}
                <button onClick={() => startEdit('year', String(movie.year ?? ''))} className="text-gray-600 opacity-0 group-hover/year:opacity-100 hover:text-gray-300 transition-all text-xs" title="Edit year">✎</button>
              </span>
            )}
            {movie.runtime && <span>{movie.runtime} min</span>}
            {movie.rating !== null && (
              <span className="text-yellow-400">★ {movie.rating.toFixed(1)}</span>
            )}
            {movie.scanRoot && (
              <span className="text-gray-500">{movie.scanRoot.label}</span>
            )}
            {(() => {
              const targets = scanRoots.filter((r) => r.type === 'movies' && r.id !== movie.scanRoot?.id)
              if (targets.length === 0) return null
              return (
                <span className="flex items-center gap-1">
                  <select
                    value={moveTarget}
                    onChange={(e) => setMoveTarget(e.target.value)}
                    className="text-xs bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-gray-300"
                  >
                    <option value="">Move to…</option>
                    {targets.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                  {moveTarget && (
                    <button
                      onClick={handleMove}
                      disabled={moving}
                      className="text-xs px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-40"
                    >
                      {moving ? '…' : 'Move'}
                    </button>
                  )}
                </span>
              )
            })()}
          </div>

          {movie.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {movie.genres.map((g) => (
                <span key={g} className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                  {g}
                </span>
              ))}
            </div>
          )}

          {(movie.tmdbId || movie.imdbId) && (
            <p className="text-xs text-gray-600 space-x-3">
              {movie.tmdbId && <span>TMDB: {movie.tmdbId}</span>}
              {movie.imdbId && <span>IMDb: {movie.imdbId}</span>}
            </p>
          )}

          {editField === 'overview' ? (
            <div className="space-y-2 max-w-2xl">
              <textarea
                autoFocus
                rows={4}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setEditField(null); setEditValue('') } }}
                className="w-full bg-gray-800 border border-accent/60 rounded px-2 py-1.5 text-sm text-gray-100 leading-relaxed focus:outline-none resize-none"
              />
              <div className="flex gap-2">
                <button onClick={() => void handleSaveField()} disabled={savingField} className="text-xs px-2.5 py-1 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 disabled:opacity-40 transition-colors">{savingField ? '…' : 'Save'}</button>
                <button onClick={() => { setEditField(null); setEditValue('') }} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-1.5 group/overview max-w-2xl">
              {movie.overview ? (
                <p className="text-sm text-gray-300 leading-relaxed flex-1">{movie.overview}</p>
              ) : (
                <span className="text-gray-600 text-xs flex-1">No overview</span>
              )}
              <button onClick={() => startEdit('overview', movie.overview ?? '')} className="text-gray-600 opacity-0 group-hover/overview:opacity-100 hover:text-gray-300 transition-all text-xs shrink-0 mt-0.5" title="Edit overview">✎</button>
            </div>
          )}

          {directors.length > 0 && (
            <p className="text-sm text-gray-400">
              <span className="text-gray-500">Director: </span>
              {directors.map((c) => c.person.name).join(', ')}
            </p>
          )}

          {/* External links + match button */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-2 text-xs">
              {movie.tmdbId && (
                <a
                  href={`https://www.themoviedb.org/movie/${movie.tmdbId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-0.5 rounded bg-gray-700/60 text-accent hover:underline"
                >
                  TMDB ↗
                </a>
              )}
              {movie.imdbId && (
                <a
                  href={`https://www.imdb.com/title/${movie.imdbId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-0.5 rounded bg-gray-700/60 text-accent hover:underline"
                >
                  IMDb ↗
                </a>
              )}
              {movie.tmdbId && jellyfinConfigured && (
                <button
                  onClick={() => { void handleOpenInJellyfin() }}
                  disabled={openingJellyfin}
                  className="px-2 py-0.5 rounded bg-gray-700/60 text-purple-400 hover:underline disabled:opacity-40"
                >
                  {openingJellyfin ? '…' : 'Jellyfin ↗'}
                </button>
              )}
            </div>
            {movie.tmdbId ? (
              <>
                <button
                  onClick={() => { void handleRematch() }}
                  disabled={rematching}
                  className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors disabled:opacity-40"
                  title="Refresh metadata from TMDB using current match"
                >
                  {rematching ? 'Refreshing…' : 'Re-match'}
                </button>
                <button
                  onClick={() => setShowMatchModal(true)}
                  className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors"
                  title="Assign a different TMDB entry"
                >
                  Match
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowMatchModal(true)}
                className="text-xs px-2.5 py-1 rounded border border-yellow-700/60 hover:border-accent/60 text-yellow-400 hover:text-accent transition-colors"
              >
                ⚠ Match to TMDB
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs px-2.5 py-1 rounded border border-red-700/40 text-red-500 hover:bg-red-700/20 transition-colors disabled:opacity-40"
              title="Remove this record from the database (files on disk are not affected)"
            >
              {deleting ? 'Removing…' : 'Remove record'}
            </button>
            {movie.files.length <= 1 && movie.files.length > 0 && (
              <button
                onClick={openDeleteWithFilesModal}
                className="text-xs px-2.5 py-1 rounded border border-red-700/40 text-red-500 hover:bg-red-700/20 transition-colors"
              >
                Delete from disk
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cast */}
      {cast.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Cast</h2>
          <div className="flex flex-wrap gap-2">
            {cast.map((c) => (
              <div key={c.id} className="text-xs bg-surface-raised border border-gray-700 rounded px-2 py-1">
                <span className="text-gray-100">{c.person.name}</span>
                {c.character && (
                  <span className="text-gray-500 ml-1">as {c.character}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Files */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Files</h2>
          <div className="flex items-center gap-2">
            {rescanResult && <span className="text-xs text-gray-400">{rescanResult}</span>}
            <button
              onClick={handleRescan}
              disabled={rescanning}
              className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors disabled:opacity-40"
            >
              {rescanning ? 'Rescanning…' : 'Rescan folder'}
            </button>
          </div>
        </div>

        {movie.files.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-red-400 font-medium">⚠ No video file attached to this record.</p>
            <p className="text-sm text-gray-500">This is a stale record — the file was likely deleted or moved without re-scanning. Use the Remove record button above to clean it up.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={fileOrder.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {(() => {
                    const editionGroupSize = new Map<string | null, number>()
                    for (const f of fileOrder) {
                      const key = f.edition ?? null
                      editionGroupSize.set(key, (editionGroupSize.get(key) ?? 0) + 1)
                    }
                    const editionGroupIndex = new Map<string | null, number>()
                    return fileOrder.map((file) => {
                      const key = file.edition ?? null
                      const groupIdx = editionGroupIndex.get(key) ?? 0
                      editionGroupIndex.set(key, groupIdx + 1)
                      const partLabel = (editionGroupSize.get(key) ?? 1) > 1 ? `part ${groupIdx + 1}` : null
                      return (
                    <SortableFileCard
                      key={file.id}
                      file={file}
                      partLabel={partLabel}
                      totalFiles={fileOrder.length}
                      editingEditionFileId={editingEditionFileId}
                      editionInput={editionInput}
                      savingEdition={savingEdition}
                      editions={editions}
                      editingGlobalEdition={editingGlobalEdition}
                      globalRenameInput={globalRenameInput}
                      renamingGlobal={renamingGlobal}
                      threeDPickerFileId={threeDPickerFileId}
                      handlers={{
                        openEditionPicker,
                        closeEditionPicker,
                        setEditionInput,
                        saveEdition: (fileId) => { void handleSaveEdition(fileId) },
                        setEditingGlobalEdition,
                        setGlobalRenameInput,
                        globalRename: (from) => { void handleGlobalRename(from) },
                        openThreeDPicker,
                        setThreeD: (fileId, value) => { void handleSetThreeD(fileId, value) },
                        ...(movie.files.length > 1 ? { deleteFile: (fileId: string) => { void handleDeleteFileSingle(fileId) } } : {}),
                      }}
                    />
                      )
                    })
                  })()}
                </div>
              </SortableContext>
            </DndContext>
            {fileOrder.length > 1 && (
              <button
                onClick={() => { void handleSaveOrder() }}
                disabled={savingOrder}
                className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors disabled:opacity-40"
              >
                {savingOrder ? 'Saving…' : 'Save file order'}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Rename & Organize */}
      {movie.files.length > 0 && (
        <MovieFilesPanel movieId={movie.id} onDone={() => { load(); setCleanupTrigger((n) => n + 1) }} onHasItems={setMovieRenameCount} />
      )}

      {/* Folder cleanup */}
      {movie.files.length > 0 && (
        <MovieFolderCleanupPanel movieId={movie.id} autoScanTrigger={cleanupTrigger} onHasItems={setMovieCleanupCount} />
      )}

      {/* Duplicate copies */}
      {siblings.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-orange-400">
            Duplicate Copies
            <span className="text-sm font-normal text-gray-500 ml-2">({siblings.length + 1} records share this TMDB ID)</span>
          </h2>
          <div className="bg-surface-raised border border-orange-700/30 rounded-lg divide-y divide-gray-700/60">
            {siblings.filter((s) => !s.dismissedAsDuplicate).map((s) => {
              const file = s.files[0]
              const folder = file?.path ? file.path.split('/').slice(0, -1).join('/') : null
              const filename = file?.path ? file.path.split('/').pop() : null
              return (
                <div key={s.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-gray-200">{s.scanRoot?.label ?? 'Unknown collection'}</span>
                      {file?.edition && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-teal-900/40 border border-teal-700/40 text-teal-300">{file.edition}</span>
                      )}
                    </div>
                    {folder && (
                      <p className="text-xs text-gray-500 font-mono truncate" title={folder}>{folder}</p>
                    )}
                    {filename && (
                      <p className="text-xs text-gray-400 font-mono truncate">{filename}</p>
                    )}
                    {file && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {file.videoQualityTier && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-teal-400 border border-gray-700">{file.videoQualityTier}</span>}
                        {file.videoCodec && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{file.videoCodec}</span>}
                        {file.audioCodec && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{file.audioCodec}</span>}
                      </div>
                    )}
                    {s.files.length === 0 && <p className="text-xs text-red-400">No files (stale record)</p>}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      onClick={() => navigate(`/movies/${s.id}`)}
                      className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors"
                    >
                      Browse →
                    </button>
                    <button
                      onClick={() => setConsolidateTarget(s)}
                      className="text-xs px-2.5 py-1 rounded border border-blue-700/40 text-blue-400 hover:bg-blue-700/20 transition-colors"
                    >
                      Consolidate
                    </button>
                    <button
                      onClick={() => setReplaceTarget(s)}
                      className="text-xs px-2.5 py-1 rounded border border-yellow-700/40 text-yellow-400 hover:bg-yellow-700/20 transition-colors"
                    >
                      Replace
                    </button>
                    <button
                      onClick={() => { void handleDismiss(s.id) }}
                      disabled={dismissingId === s.id}
                      className="text-xs px-2.5 py-1 rounded border border-gray-600 text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors disabled:opacity-40"
                    >
                      {dismissingId === s.id ? '…' : 'Dismiss'}
                    </button>
                    <button
                      onClick={() => { void handleDeleteSibling(s.id) }}
                      disabled={deletingSiblingId === s.id}
                      className="text-xs px-2.5 py-1 rounded border border-red-700/40 text-red-500 hover:bg-red-700/20 transition-colors disabled:opacity-40"
                    >
                      {deletingSiblingId === s.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Dismissed siblings */}
          {siblings.filter((s) => s.dismissedAsDuplicate).length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1">Dismissed (intentional duplicates):</p>
              <div className="bg-surface-raised border border-gray-700/40 rounded-lg divide-y divide-gray-700/40">
                {siblings.filter((s) => s.dismissedAsDuplicate).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-4 px-4 py-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-500">{s.scanRoot?.label ?? 'Unknown collection'}</span>
                      {s.files[0]?.edition && (
                        <span className="text-xs ml-2 text-gray-600">{s.files[0].edition}</span>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => navigate(`/movies/${s.id}`)} className="text-xs text-gray-500 hover:text-accent transition-colors">Browse →</button>
                      <button
                        onClick={() => { void handleUndismiss(s.id) }}
                        disabled={dismissingId === s.id}
                        className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
                      >
                        {dismissingId === s.id ? '…' : 'Undo dismiss'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-gray-600">Consolidate moves files here · Replace swaps your copy · Dismiss hides intentional duplicates · Delete removes from disk.</p>
        </section>
      )}

      {/* Artwork Manager */}
      <ArtworkManager
        posterDownloaded={movie.posterDownloaded}
        backdropDownloaded={movie.backdropDownloaded}
        api={{
          download: (type) => triggerMovieDownload(movie.id, type),
          searchImages: () => fetchMovieImages(movie.id),
          selectImage: (filePath, artworkType) => selectMovieImage(movie.id, filePath, artworkType),
        }}
        onUpdated={() => { load(); setArtworkVersion((v) => v + 1) }}
      />

      {showDeleteModal && deletePreview && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-gray-700 rounded-xl w-full max-w-lg space-y-4 p-6">
            <h2 className="text-lg font-semibold text-red-400">Delete movie from disk</h2>
            <p className="text-sm text-gray-400">
              The following files will be <span className="text-red-400 font-medium">permanently deleted</span>. This cannot be undone.
            </p>
            <div className="bg-gray-900 rounded-lg border border-gray-700 divide-y divide-gray-800 max-h-64 overflow-y-auto text-xs">
              {deletePreview.files.map((f) => (
                <div key={f.path} className="flex items-center justify-between px-3 py-2 gap-3">
                  <span className="text-gray-300 break-all">{f.name}</span>
                  <span className="text-gray-500 shrink-0">{f.size > 0 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : '—'}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 break-all">{deletePreview.folderPath}</p>
            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deletingWithFiles}
                className="text-sm px-4 py-1.5 rounded border border-gray-600 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteWithFiles}
                disabled={deletingWithFiles}
                className="text-sm px-4 py-1.5 rounded bg-red-700/30 border border-red-700/60 text-red-300 hover:bg-red-700/50 transition-colors disabled:opacity-40"
              >
                {deletingWithFiles ? 'Deleting…' : 'Permanently delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Consolidate modal */}
      {consolidateTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-gray-700 rounded-xl w-full max-w-lg space-y-4 p-6">
            <h2 className="text-lg font-semibold text-blue-400">Consolidate into "{movie.scanRoot?.label ?? 'this collection'}"</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Moving in from "{consolidateTarget.scanRoot?.label ?? 'other collection'}" ({consolidateTarget.fileCount} file{consolidateTarget.fileCount !== 1 ? 's' : ''})</p>
                {consolidateTarget.files[0] && (
                  <div className="bg-gray-900 rounded px-3 py-2 font-mono text-xs text-gray-300 flex items-center gap-2">
                    <span className="truncate">{consolidateTarget.files[0].path?.split('/').pop()}</span>
                    {consolidateTarget.files[0].videoQualityTier && <span className="text-teal-400 shrink-0">{consolidateTarget.files[0].videoQualityTier}</span>}
                  </div>
                )}
                {consolidateTarget.fileCount > 1 && <p className="text-xs text-gray-500 mt-1">+ {consolidateTarget.fileCount - 1} more file{consolidateTarget.fileCount - 1 !== 1 ? 's' : ''}</p>}
              </div>
              <div>
                <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Already here ({movie.files.length} file{movie.files.length !== 1 ? 's' : ''})</p>
                {movie.files.slice(0, 2).map((f) => (
                  <div key={f.id} className="bg-gray-900 rounded px-3 py-2 font-mono text-xs text-gray-400 truncate">{f.path.split('/').pop()}</div>
                ))}
              </div>
              <p className="text-gray-400">After consolidating: <span className="text-gray-200">{movie.files.length + consolidateTarget.fileCount} files</span> in "{movie.scanRoot?.label ?? 'this collection'}"</p>
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setConsolidateTarget(null)} disabled={consolidating} className="text-sm px-4 py-1.5 rounded border border-gray-600 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={() => { void handleConsolidate() }} disabled={consolidating} className="text-sm px-4 py-1.5 rounded bg-blue-700/30 border border-blue-700/60 text-blue-300 hover:bg-blue-700/50 transition-colors disabled:opacity-40">
                {consolidating ? 'Consolidating…' : 'Consolidate →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace modal */}
      {replaceTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-gray-700 rounded-xl w-full max-w-lg space-y-4 p-6">
            <h2 className="text-lg font-semibold text-yellow-400">Replace files in "{movie.scanRoot?.label ?? 'this collection'}"</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-red-400 text-xs uppercase tracking-wide mb-1">Permanently deleting ({movie.files.length} file{movie.files.length !== 1 ? 's' : ''})</p>
                {movie.files.slice(0, 2).map((f) => (
                  <div key={f.id} className="bg-gray-900 rounded px-3 py-2 font-mono text-xs text-red-400/70 truncate line-through">{f.path.split('/').pop()}</div>
                ))}
                {movie.files.length > 2 && <p className="text-xs text-gray-500 mt-1">+ {movie.files.length - 2} more</p>}
              </div>
              <div>
                <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Moving in from "{replaceTarget.scanRoot?.label ?? 'other collection'}" ({replaceTarget.fileCount} file{replaceTarget.fileCount !== 1 ? 's' : ''})</p>
                {replaceTarget.files[0] && (
                  <div className="bg-gray-900 rounded px-3 py-2 font-mono text-xs text-gray-300 flex items-center gap-2">
                    <span className="truncate">{replaceTarget.files[0].path?.split('/').pop()}</span>
                    {replaceTarget.files[0].videoQualityTier && <span className="text-teal-400 shrink-0">{replaceTarget.files[0].videoQualityTier}</span>}
                  </div>
                )}
                {replaceTarget.fileCount > 1 && <p className="text-xs text-gray-500 mt-1">+ {replaceTarget.fileCount - 1} more file{replaceTarget.fileCount - 1 !== 1 ? 's' : ''}</p>}
              </div>
              <p className="text-xs text-red-400/80">⚠ Current files will be permanently deleted. This cannot be undone.</p>
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setReplaceTarget(null)} disabled={replacing} className="text-sm px-4 py-1.5 rounded border border-gray-600 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40">Cancel</button>
              <button onClick={() => { void handleReplace() }} disabled={replacing} className="text-sm px-4 py-1.5 rounded bg-yellow-700/30 border border-yellow-700/60 text-yellow-300 hover:bg-yellow-700/50 transition-colors disabled:opacity-40">
                {replacing ? 'Replacing…' : 'Replace — delete current & import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel="Delete"
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {showMatchModal && (
        <MatchModal
          mediaType="movie"
          id={movie.id}
          currentTitle={movie.title}
          currentTmdbId={movie.tmdbId}
          fetchCandidates={fetchMovieCandidates}
          onMatch={matchMovie}
          onClose={() => setShowMatchModal(false)}
          onMatched={() => { setShowMatchModal(false); void load().then(() => setArtworkVersion(Date.now())) }}
        />
      )}
    </div>
  )
}

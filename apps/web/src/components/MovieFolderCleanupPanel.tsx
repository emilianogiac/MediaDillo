import { useState, useEffect, useRef } from 'react'
import { fetchMovieFolderScan, cleanupMovieFolder } from '../api/movies.js'
import type { FolderFile } from '../api/movies.js'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const CATEGORY_LABEL: Record<string, { label: string; color: string }> = {
  video: { label: 'Video', color: 'text-blue-400' },
  artwork: { label: 'Artwork', color: 'text-green-400' },
  subtitle: { label: 'Subtitle', color: 'text-gray-400' },
  nfo: { label: 'NFO', color: 'text-gray-400' },
  'extra-art': { label: 'Old artwork', color: 'text-yellow-400' },
  'extra-nfo': { label: 'Old NFO', color: 'text-yellow-400' },
  unknown: { label: 'Unknown', color: 'text-orange-400' },
}

// Pre-select everything except what MediaDillo creates/needs: video, canonical artwork, canonical nfo
const SAFE_TO_DELETE: Set<string> = new Set(['extra-art', 'extra-nfo', 'subtitle', 'unknown'])

interface Props {
  movieId: string
  autoScanTrigger?: number
}

export function MovieFolderCleanupPanel({ movieId, autoScanTrigger }: Props) {
  const [open, setOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [files, setFiles] = useState<FolderFile[] | null>(null)
  const [folderPath, setFolderPath] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleted, setDeleted] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const prevTrigger = useRef(autoScanTrigger)

  useEffect(() => {
    if (autoScanTrigger === undefined) return
    if (autoScanTrigger === prevTrigger.current) return
    prevTrigger.current = autoScanTrigger
    setOpen(true)
    void scan()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScanTrigger])

  async function scan() {
    setScanning(true)
    setError(null)
    setFiles(null)
    setDeleted(null)
    try {
      const data = await fetchMovieFolderScan(movieId)
      setFolderPath(data.folderPath)
      setFiles(data.files)
      setSelected(new Set(data.files.filter((f) => SAFE_TO_DELETE.has(f.category)).map((f) => f.path)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to scan folder')
    } finally {
      setScanning(false)
    }
  }

  async function handleDelete() {
    if (selected.size === 0) return
    setDeleting(true)
    setError(null)
    try {
      const result = await cleanupMovieFolder(movieId, [...selected])
      setDeleted(result.deleted)
      // Re-scan to refresh the list
      const data = await fetchMovieFolderScan(movieId)
      setFolderPath(data.folderPath)
      setFiles(data.files)
      setSelected(new Set(data.files.filter((f) => SAFE_TO_DELETE.has(f.category)).map((f) => f.path)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete files')
    } finally {
      setDeleting(false)
    }
  }

  function toggleFile(filePath: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(filePath) ? next.delete(filePath) : next.add(filePath)
      return next
    })
  }

  const deletableFiles = files?.filter((f) => f.category !== 'video') ?? []
  const extraCount = files?.filter((f) => SAFE_TO_DELETE.has(f.category)).length ?? 0

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Folder cleanup</h2>
        <button
          onClick={() => {
            if (!open) { setOpen(true); scan() } else setOpen(false)
          }}
          className="text-xs px-2.5 py-1 rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
        >
          {open ? 'Hide' : `Scan folder${extraCount > 0 ? ` (${extraCount} extra)` : ''}`}
        </button>
      </div>

      {open && (
        <div className="space-y-2">
          {scanning && <p className="text-sm text-gray-500">Scanning…</p>}

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">{error}</p>
          )}

          {deleted !== null && (
            <p className="text-sm text-green-400">{deleted} file{deleted !== 1 ? 's' : ''} deleted.</p>
          )}

          {files !== null && (
            <>
              <p className="text-xs text-gray-600 font-mono break-all">{folderPath}</p>
              <div className="bg-surface-raised border border-gray-800 rounded-lg divide-y divide-gray-800 text-sm">
                {files.length === 0 && (
                  <p className="px-3 py-4 text-gray-500 text-center text-xs">Folder is empty.</p>
                )}
                {files.map((file) => {
                  const cat = CATEGORY_LABEL[file.category] ?? { label: file.category, color: 'text-gray-400' }
                  const isDeletable = file.category !== 'video'
                  const isChecked = selected.has(file.path)
                  return (
                    <div key={file.path} className={`flex items-center gap-3 px-3 py-2 ${isChecked ? 'bg-red-900/10' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={!isDeletable}
                        onChange={() => isDeletable && toggleFile(file.path)}
                        className="accent-red-500 cursor-pointer disabled:opacity-30"
                      />
                      <span className="flex-1 text-xs text-gray-200 font-mono truncate" title={file.name}>{file.name}</span>
                      <span className={`text-xs flex-shrink-0 ${cat.color}`}>{cat.label}</span>
                      <span className="text-xs text-gray-600 flex-shrink-0 tabular-nums w-16 text-right">{formatBytes(file.size)}</span>
                    </div>
                  )
                })}
              </div>

              {deletableFiles.length > 0 && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDelete}
                    disabled={selected.size === 0 || deleting}
                    className="text-xs px-3 py-1.5 rounded bg-red-800/40 border border-red-700/60 text-red-300 hover:bg-red-800/60 disabled:opacity-40 transition-colors"
                  >
                    {deleting ? 'Deleting…' : `Delete ${selected.size} file${selected.size !== 1 ? 's' : ''}`}
                  </button>
                  <button
                    onClick={scan}
                    disabled={scanning || deleting}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
                  >
                    Refresh
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

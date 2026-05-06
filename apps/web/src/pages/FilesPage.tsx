import { useState, useEffect, useCallback } from 'react'
import type {
  RenamePreviewItem,
  StaleFile,
  MultiPartCandidate,
  EpisodeFileRecord,
} from '../api/files.js'
import {
  fetchRenamePreview,
  applyRenames,
  fetchStaleFiles,
  deleteStaleFile,
  resolveStaleFile,
  bulkDeleteStaleFiles,
  fetchMultiPartMovies,
  mergeMovieParts,
  fetchEpisodeFiles,
  remapEpisode,
} from '../api/files.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basename(p: string) {
  return p.split('/').pop() ?? p
}

function dirname(p: string) {
  const parts = p.split('/')
  parts.pop()
  return parts.join('/')
}

// ---------------------------------------------------------------------------
// Rename Queue tab
// ---------------------------------------------------------------------------

function RenameTab() {
  const [type, setType] = useState<'movies' | 'episodes'>('movies')
  const [showFolderItems, setShowFolderItems] = useState<RenamePreviewItem[]>([])
  const [fileItems, setFileItems] = useState<RenamePreviewItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ renamed: number; errors: string[] } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const all = await fetchRenamePreview(type)
      const pending = all.filter((i) => i.needsRename)
      const folders = pending.filter((i) => i.type === 'show-folder')
      const files = pending.filter((i) => i.type !== 'show-folder')
      setShowFolderItems(folders)
      setFileItems(files)
      setSelected(new Set(files.map((i) => i.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [type])

  useEffect(() => { load() }, [load])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === fileItems.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(fileItems.map((i) => i.id)))
    }
  }

  async function apply() {
    const ids = [...selected]
    if (ids.length === 0 && showFolderItems.length === 0) return
    setApplying(true)
    setError(null)
    setResult(null)
    try {
      const res = await applyRenames(type, ids, showFolderItems.length > 0 ? showFolderItems : undefined)
      await load()
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed')
    } finally {
      setApplying(false)
    }
  }

  const totalPending = showFolderItems.length + fileItems.length

  return (
    <div className="space-y-4">
      {/* Type toggle */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500">Library:</span>
        {(['movies', 'episodes'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={[
              'px-3 py-1 rounded text-sm transition-colors',
              type === t ? 'bg-accent/20 text-accent' : 'text-gray-400 hover:text-gray-200',
            ].join(' ')}
          >
            {t === 'movies' ? 'Movies' : 'TV Episodes'}
          </button>
        ))}
      </div>

      {loading && <div className="py-8 text-center text-gray-500">Scanning…</div>}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <div className={`text-sm p-3 rounded ${result.errors.length > 0 ? 'bg-yellow-900/30 text-yellow-300' : 'bg-green-900/30 text-green-300'}`}>
          {result.renamed} item{result.renamed !== 1 ? 's' : ''} renamed.
          {result.errors.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-yellow-400">
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {!loading && totalPending === 0 && (
        <div className="py-12 text-center text-gray-500 text-sm">
          All {type === 'movies' ? 'movie' : 'episode'} files follow the naming convention.
        </div>
      )}

      {totalPending > 0 && (
        <>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={fileItems.length > 0 && selected.size === fileItems.length}
                onChange={toggleAll}
                className="accent-accent"
              />
              {selected.size}/{fileItems.length} files selected
              {showFolderItems.length > 0 && (
                <span className="text-yellow-500 ml-1">+ {showFolderItems.length} folder rename{showFolderItems.length !== 1 ? 's' : ''} (always applied)</span>
              )}
            </label>
            <button
              onClick={apply}
              disabled={applying || (selected.size === 0 && showFolderItems.length === 0)}
              className="px-4 py-1.5 text-sm rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-40 transition-colors"
            >
              {applying ? 'Applying…' : `Apply ${selected.size + showFolderItems.length} rename${(selected.size + showFolderItems.length) !== 1 ? 's' : ''}`}
            </button>
          </div>

          <div className="space-y-2">
            {/* Show folder renames always visible and non-deselectable */}
            {showFolderItems.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 bg-yellow-900/10 border border-yellow-700/40 rounded-lg p-3"
              >
                <span className="mt-0.5 text-xs px-1.5 py-0.5 rounded bg-yellow-700/40 text-yellow-300 font-medium flex-shrink-0">Folder</span>
                <div className="min-w-0 space-y-1 flex-1 text-xs font-mono">
                  <span className="text-red-400 line-through truncate block">{basename(item.currentPath)}</span>
                  <span className="text-green-400 truncate block">{basename(item.proposedPath)}</span>
                </div>
              </div>
            ))}

            {/* Individual file renames, selectable */}
            {fileItems.map((item) => {
              const currentDir = dirname(item.currentPath)
              const proposedDir = dirname(item.proposedPath)
              const dirChanged = currentDir !== proposedDir

              return (
                <label
                  key={item.id}
                  className="flex items-start gap-3 bg-surface-raised border border-gray-700 rounded-lg p-3 cursor-pointer hover:border-gray-600 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    className="mt-0.5 accent-accent flex-shrink-0"
                  />
                  <div className="min-w-0 space-y-1 flex-1">
                    {dirChanged && (
                      <div className="text-xs text-yellow-500">
                        Folder: <span className="font-mono">{basename(currentDir)}</span>
                        {' → '}
                        <span className="font-mono">{basename(proposedDir)}</span>
                      </div>
                    )}
                    <div className="text-xs font-mono">
                      <span className="text-red-400 line-through truncate block">{basename(item.currentPath)}</span>
                      <span className="text-green-400 truncate block">{basename(item.proposedPath)}</span>
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stale Files tab
// ---------------------------------------------------------------------------

function StaleTab() {
  const [items, setItems] = useState<StaleFile[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchStaleFiles()
      setItems(data.items)
      setTotal(data.total)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === items.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(items.map((i) => i.id)))
    }
  }

  async function deleteSingle(id: string) {
    setBusy(true)
    try {
      await deleteStaleFile(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  async function resolveSingle(id: string) {
    setBusy(true)
    try {
      await resolveStaleFile(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resolve failed')
    } finally {
      setBusy(false)
    }
  }

  async function bulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    setBusy(true)
    try {
      await bulkDeleteStaleFiles(ids)
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)))
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk delete failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="py-8 text-center text-gray-500">Loading…</div>

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{total} unresolved stale file{total !== 1 ? 's' : ''}</span>
        {items.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selected.size === items.length}
                onChange={toggleAll}
                className="accent-accent"
              />
              {selected.size}/{items.length}
            </label>
            <button
              onClick={bulkDelete}
              disabled={busy || selected.size === 0}
              className="text-sm px-3 py-1 rounded bg-red-800/60 hover:bg-red-700/60 text-red-300 disabled:opacity-40 transition-colors"
            >
              {busy ? 'Working…' : `Delete ${selected.size} to trash`}
            </button>
          </div>
        )}
      </div>

      {items.length === 0 && (
        <div className="py-12 text-center text-gray-500 text-sm">No stale files to review.</div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 bg-surface-raised border border-gray-700 rounded-lg p-3"
            >
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                className="mt-0.5 accent-accent flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-gray-300 truncate" title={item.path}>
                  {item.path}
                </p>
                {item.reason && (
                  <p className="text-xs text-gray-500 mt-0.5">{item.reason}</p>
                )}
                <p className="text-xs text-gray-600 mt-0.5">
                  Found {new Date(item.scanLog.startedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex-shrink-0 flex gap-2">
                <button
                  onClick={() => resolveSingle(item.id)}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded text-gray-400 hover:text-gray-200 bg-surface-overlay transition-colors disabled:opacity-40"
                  title="Mark as resolved (keep file)"
                >
                  Ignore
                </button>
                <button
                  onClick={() => deleteSingle(item.id)}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded text-red-400 hover:text-red-300 bg-red-900/30 transition-colors disabled:opacity-40"
                  title="Move to .trash/"
                >
                  Trash
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Multi-part tab
// ---------------------------------------------------------------------------

function MultiPartTab() {
  const [items, setItems] = useState<MultiPartCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { outputPath?: string; error?: string }>>({})

  useEffect(() => {
    fetchMultiPartMovies()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  async function merge(movieId: string) {
    setMerging(movieId)
    try {
      const res = await mergeMovieParts(movieId)
      if ('outputPath' in res) {
        setResults((prev) => ({ ...prev, [movieId]: { outputPath: res.outputPath } }))
        setItems((prev) => prev.filter((i) => i.movieId !== movieId))
      } else {
        setResults((prev) => ({ ...prev, [movieId]: { error: res.error } }))
      }
    } catch (e) {
      setResults((prev) => ({ ...prev, [movieId]: { error: e instanceof Error ? e.message : 'Failed' } }))
    } finally {
      setMerging(null)
    }
  }

  function formatSize(bytes: string | null): string {
    if (!bytes) return '—'
    const n = Number(bytes)
    const gb = n / 1_073_741_824
    return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(n / 1_048_576).toFixed(0)} MB`
  }

  if (loading) return <div className="py-8 text-center text-gray-500">Scanning…</div>
  if (error) return <p className="text-sm text-red-400">{error}</p>

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Movies detected as split across two part files (-cd1/-cd2, -part1/-part2, etc.). ffmpeg concat will produce one file.
      </p>

      {Object.entries(results).map(([id, res]) => (
        <div key={id} className={`text-sm p-3 rounded ${res.error ? 'bg-red-900/30 text-red-300' : 'bg-green-900/30 text-green-300'}`}>
          {res.error ? `Error: ${res.error}` : `Merged → ${res.outputPath}`}
        </div>
      ))}

      {items.length === 0 && Object.keys(results).length === 0 && (
        <div className="py-12 text-center text-gray-500 text-sm">No multi-part movies detected.</div>
      )}

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.movieId} className="bg-surface-raised border border-gray-700 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{item.title}{item.year ? ` (${item.year})` : ''}</p>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Merge the two parts of "${item.title}" into one file? The originals will be moved to .trash/.`)) {
                      void merge(item.movieId)
                    }
                  }}
                  disabled={merging === item.movieId}
                  className="flex-shrink-0 px-3 py-1.5 text-sm rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-40 transition-colors"
                >
                  {merging === item.movieId ? 'Merging…' : 'Merge'}
                </button>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-mono text-gray-400 truncate" title={item.part1.path}>
                  Part 1: {item.part1.path.split('/').pop()} ({formatSize(item.part1.sizeBytes)})
                </p>
                <p className="text-xs font-mono text-gray-400 truncate" title={item.part2.path}>
                  Part 2: {item.part2.path.split('/').pop()} ({formatSize(item.part2.sizeBytes)})
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Episode Remap tab
// ---------------------------------------------------------------------------

interface RemapForm {
  seasonNumber: string
  episodeStart: string
  episodeEnd: string
}

function EpisodeRemapTab() {
  const [files, setFiles] = useState<EpisodeFileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [remapping, setRemapping] = useState<string | null>(null)
  const [forms, setForms] = useState<Record<string, RemapForm>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchEpisodeFiles()
      .then(setFiles)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  function openForm(file: EpisodeFileRecord) {
    setForms((prev) => ({
      ...prev,
      [file.id]: {
        seasonNumber: String(file.episode.season.seasonNumber),
        episodeStart: String(file.episode.episodeNumber),
        episodeEnd: file.multiEpisodeEnd != null ? String(file.multiEpisodeEnd) : '',
      },
    }))
    setOpen(file.id)
  }

  async function applyRemap(file: EpisodeFileRecord) {
    const form = forms[file.id]
    if (!form) return
    const seasonNumber = parseInt(form.seasonNumber, 10)
    const episodeStart = parseInt(form.episodeStart, 10)
    const episodeEnd = form.episodeEnd ? parseInt(form.episodeEnd, 10) : undefined
    if (isNaN(seasonNumber) || isNaN(episodeStart)) return

    setRemapping(file.id)
    try {
      await remapEpisode({
        fileId: file.id,
        showId: file.episode.season.show.id,
        seasonNumber,
        episodeStart,
        ...(episodeEnd !== undefined ? { episodeEnd } : {}),
      })
      // Update local state
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id !== file.id) return f
          return {
            ...f,
            multiEpisodeEnd: episodeEnd ?? null,
            episode: {
              ...f.episode,
              episodeNumber: episodeStart,
              season: { ...f.episode.season, seasonNumber },
            },
          }
        }),
      )
      setOpen(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remap failed')
    } finally {
      setRemapping(null)
    }
  }

  const filtered = search
    ? files.filter((f) =>
        f.episode.season.show.title.toLowerCase().includes(search.toLowerCase()) ||
        f.path.toLowerCase().includes(search.toLowerCase()),
      )
    : files

  if (loading) return <div className="py-8 text-center text-gray-500">Loading…</div>
  if (error) return <p className="text-sm text-red-400">{error}</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by show or path…"
          className="flex-1 px-3 py-1.5 text-sm rounded bg-surface-raised border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
        />
        <span className="text-xs text-gray-500">{filtered.length} files</span>
      </div>

      {filtered.length === 0 && (
        <div className="py-12 text-center text-gray-500 text-sm">No episode files found.</div>
      )}

      <div className="space-y-1.5">
        {filtered.map((file) => {
          const { show, seasonNumber } = file.episode.season
          const ep = file.episode
          const code = `S${String(seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}${file.multiEpisodeEnd != null ? `E${String(file.multiEpisodeEnd).padStart(2, '0')}` : ''}`
          const isOpen = open === file.id
          const form = forms[file.id] ?? { seasonNumber: String(seasonNumber), episodeStart: String(ep.episodeNumber), episodeEnd: file.multiEpisodeEnd != null ? String(file.multiEpisodeEnd) : '' }

          return (
            <div key={file.id} className="bg-surface-raised border border-gray-700 rounded-lg overflow-hidden">
              <div className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-gray-500">{show.title} · </span>
                  <span className="text-xs font-mono text-accent">{code}</span>
                  {ep.title && <span className="text-xs text-gray-400 ml-1">— {ep.title}</span>}
                  <p className="text-xs font-mono text-gray-600 truncate mt-0.5">{file.path.split('/').pop()}</p>
                </div>
                <button
                  onClick={() => isOpen ? setOpen(null) : openForm(file)}
                  className="flex-shrink-0 text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors"
                >
                  Remap
                </button>
              </div>

              {isOpen && (
                <div className="px-3 pb-3 border-t border-gray-700/50 pt-2 flex items-end gap-2">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-xs text-gray-500">Season</span>
                    <input
                      type="number"
                      value={form.seasonNumber}
                      onChange={(e) => setForms((p) => ({ ...p, [file.id]: { ...form, seasonNumber: e.target.value } }))}
                      className="w-16 px-2 py-1 text-sm rounded bg-surface-overlay border border-gray-700 text-gray-200 focus:outline-none focus:border-accent"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-xs text-gray-500">Episode start</span>
                    <input
                      type="number"
                      value={form.episodeStart}
                      onChange={(e) => setForms((p) => ({ ...p, [file.id]: { ...form, episodeStart: e.target.value } }))}
                      className="w-20 px-2 py-1 text-sm rounded bg-surface-overlay border border-gray-700 text-gray-200 focus:outline-none focus:border-accent"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-xs text-gray-500">Episode end (multi)</span>
                    <input
                      type="number"
                      value={form.episodeEnd}
                      onChange={(e) => setForms((p) => ({ ...p, [file.id]: { ...form, episodeEnd: e.target.value } }))}
                      placeholder="—"
                      className="w-20 px-2 py-1 text-sm rounded bg-surface-overlay border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
                    />
                  </label>
                  <button
                    onClick={() => void applyRemap(file)}
                    disabled={remapping === file.id}
                    className="px-3 py-1.5 text-sm rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-40 transition-colors"
                  >
                    {remapping === file.id ? 'Saving…' : 'Apply'}
                  </button>
                  <button
                    onClick={() => setOpen(null)}
                    className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'rename' | 'multipart' | 'remap' | 'stale'

export function FilesPage() {
  const [tab, setTab] = useState<Tab>('rename')

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">File Manager</h1>

      <div className="flex gap-1 border-b border-gray-800">
        {([
          { key: 'rename', label: 'Rename Queue' },
          { key: 'multipart', label: 'Multi-part' },
          { key: 'remap', label: 'Episode Remap' },
          { key: 'stale', label: 'Stale Files' },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={[
              'px-4 py-2 text-sm font-medium -mb-px border transition-colors rounded-t',
              tab === key
                ? 'bg-surface-raised text-white border-gray-700 border-b-surface-raised'
                : 'text-gray-400 hover:text-gray-200 border-transparent',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'rename' ? <RenameTab /> : tab === 'multipart' ? <MultiPartTab /> : tab === 'remap' ? <EpisodeRemapTab /> : <StaleTab />}
    </div>
  )
}

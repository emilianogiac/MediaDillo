import { useState, useMemo } from 'react'
import type { EpisodeDetail, EpisodeFile, SeasonDetail } from '../api/types.js'
import { assignFiles, fetchShow, fetchSeason } from '../api/shows.js'
import { useToast } from '../context/ToastContext.js'

function pad(n: number) { return String(n).padStart(2, '0') }
function basename(p: string) { return p.split('/').pop() ?? p }

interface Props {
  showId: string
  seasonNumber: number
  episodes: EpisodeDetail[]
  onDone: () => void
}

// Flat episode enriched with season context for all-seasons mode
type FlatEp = EpisodeDetail & { seasonNumber: number }

// One "slot" in the assignment UI: an episode plus the file currently selected for it
interface Slot {
  ep: FlatEp
  selectedFileId: string | null // EpisodeFile.id or null
}

// All season files collected from all episodes (deduplicated by id)
function collectFiles(episodes: EpisodeDetail[]): EpisodeFile[] {
  const seen = new Set<string>()
  const result: EpisodeFile[] = []
  for (const ep of episodes) {
    for (const f of ep.files) {
      if (!seen.has(f.id)) { seen.add(f.id); result.push(f) }
    }
  }
  return result.sort((a, b) => basename(a.path).localeCompare(basename(b.path)))
}

// Build initial slot assignments from episode data
function buildSlots(eps: FlatEp[], allFiles: EpisodeFile[]): Slot[] {
  // Map episodeNumber → fileId for secondary (multi-episode) coverage
  const coveredByFile = new Map<number, string>() // episodeNumber → fileId that covers it
  for (const f of allFiles) {
    if (f.multiEpisodeEnd != null) {
      // Find the episode this file belongs to (it will be the primary ep's file)
      for (const ep of eps) {
        if (ep.files.some((ef) => ef.id === f.id)) {
          for (let n = ep.episodeNumber + 1; n <= f.multiEpisodeEnd!; n++) {
            coveredByFile.set(n, f.id)
          }
          break
        }
      }
    }
  }

  return eps.map((ep) => {
    if (ep.files.length > 0) return { ep, selectedFileId: ep.files[0]!.id }
    const covered = coveredByFile.get(ep.episodeNumber)
    return { ep, selectedFileId: covered ?? null }
  })
}

export function AssignFilesPanel({ showId, seasonNumber, episodes, onDone }: Props) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [applying, setApplying] = useState(false)

  // Single-season state
  const singleEps = useMemo<FlatEp[]>(
    () => [...episodes]
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((e) => ({ ...e, seasonNumber })),
    [episodes, seasonNumber],
  )
  const singleFiles = useMemo(() => collectFiles(singleEps), [singleEps])
  const [slots, setSlots] = useState<Slot[]>(() => buildSlots(singleEps, singleFiles))

  // All-seasons state
  const [showAll, setShowAll] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)
  const [allSlots, setAllSlots] = useState<Slot[]>([])
  const [allFiles, setAllFiles] = useState<EpisodeFile[]>([])

  function resetSingle() {
    setSlots(buildSlots(singleEps, singleFiles))
  }

  function toggleOpen() {
    if (!open) {
      setSlots(buildSlots(singleEps, singleFiles))
      setShowAll(false)
    }
    setOpen((o) => !o)
  }

  async function toggleAllSeasons() {
    if (!showAll) {
      setLoadingAll(true)
      try {
        const show = await fetchShow(showId)
        const seasonDetails: SeasonDetail[] = await Promise.all(
          show.seasons.map((s) => fetchSeason(showId, s.seasonNumber)),
        )
        const flat: FlatEp[] = seasonDetails.flatMap((s) =>
          [...s.episodes]
            .sort((a, b) => a.episodeNumber - b.episodeNumber)
            .map((ep) => ({ ...ep, seasonNumber: s.seasonNumber })),
        )
        const collected = collectFiles(flat)
        setAllFiles(collected)
        setAllSlots(buildSlots(flat, collected))
      } catch {
        toast({ type: 'error', message: 'Failed to load all seasons' })
        setLoadingAll(false)
        return
      }
      setLoadingAll(false)
    }
    setShowAll((v) => !v)
  }

  function updateSlot(index: number, fileId: string | null, isFlatMode: boolean) {
    if (isFlatMode) {
      setAllSlots((prev) => prev.map((s, i) => i === index ? { ...s, selectedFileId: fileId } : s))
    } else {
      setSlots((prev) => prev.map((s, i) => i === index ? { ...s, selectedFileId: fileId } : s))
    }
  }

  const isDirty = useMemo(() => {
    const src = showAll ? allSlots : slots
    const files = showAll ? allFiles : singleFiles
    return src.some((s) => {
      const current = s.ep.files[0]?.id ?? null
      return s.selectedFileId !== current
    })
    // suppress files/singleFiles lint; they're stable
    void files
  }, [slots, allSlots, showAll, allFiles, singleFiles])

  async function apply() {
    const src = showAll ? allSlots : slots
    const assignments = src.map((s) => ({ episodeId: s.ep.id, fileId: s.selectedFileId }))
    setApplying(true)
    try {
      const result = await assignFiles(showId, assignments)
      if (result.errors.length > 0) result.errors.forEach((e) => toast({ type: 'error', message: e }))
      else toast({ type: 'success', message: `${result.renamed} file${result.renamed !== 1 ? 's' : ''} renamed` })
      setOpen(false)
      onDone()
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Apply failed' })
    } finally {
      setApplying(false)
    }
  }

  // Don't render if there are no files in the season at all
  if (singleFiles.length === 0) return null

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={toggleOpen}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-raised hover:bg-gray-700/40 transition-colors text-left"
      >
        <span className="text-sm font-medium text-gray-200">Assign Files to Episodes</span>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-4 space-y-3 bg-surface border-t border-gray-700">
          <div className="flex items-start justify-between gap-4">
            <p className="text-xs text-gray-500">
              Use when a file covers multiple episodes (e.g. <span className="font-mono">2x01 2x02</span>) or was scanned
              to the wrong slot. Select the same file for consecutive episodes to produce a
              multi-episode name like <span className="font-mono">S02E01E02</span>.
            </p>
            <button
              onClick={() => void toggleAllSeasons()}
              disabled={loadingAll}
              className={`flex-shrink-0 text-xs px-2.5 py-1 rounded border transition-colors ${
                showAll
                  ? 'border-accent/60 text-accent bg-accent/10'
                  : 'border-gray-600 text-gray-400 hover:border-accent/60 hover:text-accent'
              } disabled:opacity-40`}
            >
              {loadingAll ? 'Loading…' : 'All seasons'}
            </button>
          </div>

          <SlotGrid
            slots={showAll ? allSlots : slots}
            files={showAll ? allFiles : singleFiles}
            showSeasonPrefix={showAll}
            onSelect={(i, fid) => updateSlot(i, fid, showAll)}
          />

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => void apply()}
              disabled={applying || !isDirty}
              className="text-sm px-4 py-1.5 rounded bg-accent text-black font-medium hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {applying ? 'Applying…' : 'Apply'}
            </button>
            {!showAll && isDirty && (
              <button
                onClick={resetSingle}
                disabled={applying}
                className="text-xs text-gray-500 hover:text-accent transition-colors"
              >
                Reset
              </button>
            )}
            {showAll && isDirty && (
              <button
                onClick={() => setAllSlots(buildSlots(
                  allSlots.map((s) => s.ep),
                  allFiles,
                ))}
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

interface SlotGridProps {
  slots: Slot[]
  files: EpisodeFile[]
  showSeasonPrefix: boolean
  onSelect: (index: number, fileId: string | null) => void
}

function SlotGrid({ slots, files, showSeasonPrefix, onSelect }: SlotGridProps) {
  return (
    <div className="space-y-1">
      {slots.map((slot, i) => {
        const ep = slot.ep
        const isNewSeason = showSeasonPrefix && (i === 0 || (slots[i - 1]?.ep as FlatEp).seasonNumber !== ep.seasonNumber)
        const label = ep.title ?? `Episode ${ep.episodeNumber}`

        return (
          <div key={ep.id}>
            {isNewSeason && i > 0 && <div className="border-t border-gray-700/50 my-1" />}
            <div className="flex items-center gap-3 h-8">
              {/* Episode label */}
              <span className="text-xs font-mono text-gray-500 w-16 flex-shrink-0">
                {showSeasonPrefix ? `S${pad(ep.seasonNumber)}E${pad(ep.episodeNumber)}` : `E${pad(ep.episodeNumber)}`}
              </span>
              <span className="text-sm text-gray-300 flex-1 min-w-0 truncate" title={label}>
                {label}
              </span>

              {/* File dropdown */}
              <select
                value={slot.selectedFileId ?? ''}
                onChange={(e) => onSelect(i, e.target.value || null)}
                className={`w-64 flex-shrink-0 text-xs bg-gray-800 border rounded px-2 py-1 focus:outline-none focus:border-accent truncate ${
                  slot.selectedFileId ? 'border-gray-600 text-gray-200' : 'border-gray-700 text-gray-600'
                }`}
              >
                <option value="">— none —</option>
                {files.map((f) => (
                  <option key={f.id} value={f.id} title={f.path}>
                    {basename(f.path)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )
      })}
    </div>
  )
}

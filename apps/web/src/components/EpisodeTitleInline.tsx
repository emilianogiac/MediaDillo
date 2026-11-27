import { useState } from 'react'
import { updateEpisodeTitle, resetEpisodeTitle } from '../api/shows.js'
import { useToast } from '../context/ToastContext.js'

export interface EpisodeTitleInlineProps {
  showId: string
  episodeId: string
  episodeNumber: number
  title: string | null
  /** `manual` means a human set this title and enrichment will not touch it (#96). */
  titleSource: 'provider' | 'manual'
  onChanged: () => void
}

const LOCK_HINT =
  'Locked: this title was set by hand and will not be overwritten when metadata refreshes.'

/**
 * Episode title with its provenance made visible and editable.
 *
 * Providers sometimes mis-attribute episode titles for a given ordering, so a
 * corrected title has to outlive the next enrich. Locking is per-episode rather
 * than per-show: a show can carry a handful of corrections and still benefit
 * from enrichment everywhere else.
 */
export function EpisodeTitleInline({
  showId,
  episodeId,
  episodeNumber,
  title,
  titleSource,
  onChanged,
}: EpisodeTitleInlineProps) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title ?? '')
  const [busy, setBusy] = useState(false)

  const locked = titleSource === 'manual'
  const display = title ?? `Episode ${episodeNumber}`

  function startEditing() {
    setDraft(title ?? '')
    setEditing(true)
  }

  async function save() {
    const next = draft.trim()
    if (next === '') {
      toast({ type: 'error', message: 'Title cannot be empty' })
      return
    }
    if (next === title) {
      setEditing(false)
      return
    }
    setBusy(true)
    try {
      await updateEpisodeTitle(showId, episodeId, next)
      setEditing(false)
      toast({ type: 'success', message: `Episode ${episodeNumber} title locked` })
      onChanged()
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Could not save title' })
    } finally {
      setBusy(false)
    }
  }

  async function release() {
    setBusy(true)
    try {
      await resetEpisodeTitle(showId, episodeId)
      toast({
        type: 'success',
        message: `Episode ${episodeNumber} title unlocked — it will refresh on the next metadata update`,
      })
      onChanged()
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Could not unlock title' })
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1.5 flex-wrap">
        <input
          autoFocus
          aria-label={`Title for episode ${episodeNumber}`}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="text-sm bg-surface border border-gray-600 focus:border-accent rounded px-1.5 py-0.5 min-w-[16rem] outline-none"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={busy}
          className="text-xs px-1.5 py-0.5 rounded text-gray-400 hover:text-gray-200 disabled:opacity-50"
        >
          Cancel
        </button>
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className="text-sm font-medium text-gray-100 truncate">{display}</span>

      {locked && (
        <span
          title={LOCK_HINT}
          aria-label="Title locked"
          className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 bg-amber-900/40 text-amber-300 border border-amber-700/50"
        >
          🔒 Locked
        </span>
      )}

      <button
        type="button"
        onClick={startEditing}
        aria-label={`Edit title for episode ${episodeNumber}`}
        className="text-xs text-gray-500 hover:text-accent flex-shrink-0"
      >
        Edit
      </button>

      {locked && (
        <button
          type="button"
          onClick={() => void release()}
          disabled={busy}
          aria-label={`Unlock title for episode ${episodeNumber}`}
          title="Hand this title back to the metadata provider"
          className="text-xs text-gray-500 hover:text-accent flex-shrink-0 disabled:opacity-50"
        >
          Unlock
        </button>
      )}
    </span>
  )
}

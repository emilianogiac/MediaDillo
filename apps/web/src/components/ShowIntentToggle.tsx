import { useState } from 'react'
import { setShowAbandoned } from '../api/shows.js'
import { useToast } from '../context/ToastContext.js'

export interface ShowIntentToggleProps {
  showId: string
  title: string
  /** #122: recorded intent not to complete this show. */
  abandoned: boolean
  ownedEpisodes: number
  totalEpisodes: number
  onChanged: () => void
}

const ABANDONED_HINT =
  'Abandoned: this show is excluded from the missing-episode queue and the wishlist.'

/**
 * Records whether a show will be completed (issue #122).
 *
 * Completeness is derivable from the episode counters, but intent is not: only a
 * human knows whether holding 61 of 2,351 One Piece episodes is a gap or a
 * deliberate sample. The library's rule is that anything kept should be
 * complete, so complete is the default and this marks the exception — which is
 * why it is a single flag rather than a three-way taxonomy.
 */
export function ShowIntentToggle({
  showId,
  title,
  abandoned,
  ownedEpisodes,
  totalEpisodes,
  onChanged,
}: ShowIntentToggleProps) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  const gap = totalEpisodes - ownedEpisodes
  const complete = totalEpisodes > 0 && gap <= 0

  async function apply(next: boolean) {
    setBusy(true)
    try {
      await setShowAbandoned(showId, next)
      toast({
        type: 'success',
        message: next
          ? `${title} marked abandoned — it will not appear in the missing queue`
          : `${title} is back in the missing queue`,
      })
      onChanged()
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Could not save' })
    } finally {
      setBusy(false)
    }
  }

  if (abandoned) {
    return (
      <span className="flex items-center gap-1.5">
        <span
          title={ABANDONED_HINT}
          aria-label="Show abandoned"
          className="text-xs px-2 py-0.5 rounded-full font-medium bg-rose-900/40 text-rose-300 border border-rose-700/50"
        >
          Abandoned
        </span>
        <button
          type="button"
          onClick={() => void apply(false)}
          disabled={busy}
          aria-label={`Resume collecting ${title}`}
          title="Put this show back in the missing-episode queue"
          className="text-xs text-gray-500 hover:text-accent disabled:opacity-50"
        >
          Resume
        </button>
      </span>
    )
  }

  // Nothing to abandon on a complete show, and no provider data means no gap to
  // judge — offering the control there would invite a meaningless decision.
  if (complete || totalEpisodes === 0) return null

  return (
    <button
      type="button"
      onClick={() => void apply(true)}
      disabled={busy}
      aria-label={`Mark ${title} abandoned`}
      title={`Missing ${gap} episode${gap !== 1 ? 's' : ''}. Mark abandoned to drop it from the missing queue.`}
      className="text-xs px-2 py-0.5 rounded-full border border-gray-700 text-gray-500 hover:text-rose-300 hover:border-rose-700/50 disabled:opacity-50"
    >
      Abandon
    </button>
  )
}

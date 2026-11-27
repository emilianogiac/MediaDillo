import type { OrganizePreview } from '../api/shows.js'

export interface OrganizeDots {
  /** Episode files whose names are not canonical yet. */
  renames: boolean
  /** The show's own folder is not named `Title (Year)` yet. */
  folder: boolean
  /** Stale files the cleanup would remove. */
  removals: boolean
}

/**
 * Split an organize preview into the signals the show page displays.
 *
 * `folder` is tracked separately and deliberately: the badge used to look only
 * at episode-file renames, so a show whose files were canonical but whose
 * folder was not read "✓ Organized" on its own page while the shows list — which
 * compares nothing but the folder name — filed it as unorganized (issue #109).
 */
export function organizeDotsFrom(preview: OrganizePreview): OrganizeDots {
  return {
    renames: preview.renames.some((r) => r.type === 'episode-file'),
    folder: preview.renames.some((r) => r.type === 'show-folder'),
    removals: preview.removals.length > 0,
  }
}

/** A show is shown as organized only when the preview has nothing left to do. */
export function isFullyOrganized(dots: OrganizeDots): boolean {
  return !dots.renames && !dots.folder && !dots.removals
}

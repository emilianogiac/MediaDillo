import { describe, it, expect } from 'vitest'
import { organizeDotsFrom, isFullyOrganized } from './organizeDots.js'
import type { OrganizePreview } from '../api/shows.js'

/**
 * Issue #109.
 *
 * The show page's "✓ Organized" badge counted pending episode-file renames and
 * silently dropped the pending show-folder rename. Since the shows list decides
 * organized/unorganized purely from the folder name, a show could show the badge
 * on its own page and still be caught by the unorganized filter on the list —
 * which is exactly what `IT - Il pagliaccio assassino` and `Conte Dacula` did.
 */
function preview(over: Partial<OrganizePreview> = {}): OrganizePreview {
  return { renames: [], removals: [], showFolder: '/mnt/nas/serie_tv/Show (2000)', ...over } as OrganizePreview
}
const episodeRename = { type: 'episode-file', currentPath: '/a/b.mkv', proposedPath: '/a/c.mkv' }
const folderRename = { type: 'show-folder', currentPath: '/mnt/nas/serie_tv/It (1990)', proposedPath: '/mnt/nas/serie_tv/IT (1990)' }

describe('organizeDotsFrom (issue #109)', () => {
  it('reports nothing pending for a clean show', () => {
    const dots = organizeDotsFrom(preview())
    expect(dots).toEqual({ renames: false, folder: false, removals: false })
    expect(isFullyOrganized(dots)).toBe(true)
  })

  it('flags a pending folder rename even when every episode file is canonical', () => {
    // The exact shape of the bug: files fine, folder wrong.
    const dots = organizeDotsFrom(preview({ renames: [folderRename] as OrganizePreview['renames'] }))
    expect(dots.renames).toBe(false)
    expect(dots.folder).toBe(true)
    expect(isFullyOrganized(dots)).toBe(false)
  })

  it('flags pending episode renames', () => {
    const dots = organizeDotsFrom(preview({ renames: [episodeRename] as OrganizePreview['renames'] }))
    expect(dots.renames).toBe(true)
    expect(dots.folder).toBe(false)
    expect(isFullyOrganized(dots)).toBe(false)
  })

  it('separates the two kinds so the rename button is not driven by the folder', () => {
    const dots = organizeDotsFrom(
      preview({ renames: [folderRename, episodeRename] as OrganizePreview['renames'] }),
    )
    expect(dots).toMatchObject({ renames: true, folder: true })
  })

  it('flags stale files awaiting removal', () => {
    const dots = organizeDotsFrom(preview({ removals: [{ path: '/a/stale.nfo' }] as OrganizePreview['removals'] }))
    expect(dots.removals).toBe(true)
    expect(isFullyOrganized(dots)).toBe(false)
  })
})

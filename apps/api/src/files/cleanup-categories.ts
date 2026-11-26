/**
 * How a file sitting in a movie folder is classified, and which classes an unattended
 * cleanup is allowed to remove.
 *
 * Kept free of database imports so the rules can be unit-tested directly. These
 * decisions drive deletions, so the boundary deserves tests of its own (issue #75).
 */

// 'unknown-video' is kept separate from 'unknown': a video file the scanner has not
// recorded yet (just copied in, a new part, another edition) must never be swept up by
// an automatic cleanup. 'subtitle' is likewise content, not clutter.
export type FolderFileCategory =
  | 'video'
  | 'artwork'
  | 'subtitle'
  | 'nfo'
  | 'extra-art'
  | 'extra-nfo'
  | 'unknown-video'
  | 'unknown'

// Categories an UNATTENDED cleanup may remove. Deliberately excludes:
//   'subtitle'      — a subtitle is content the user chose to keep, not clutter. It was
//                     previously included, so matching a movie silently and permanently
//                     deleted every subtitle in its folder (issue #75).
//   'unknown-video' — deleting an unrecognised video is never safe automatically.
export const BATCH_SAFE_TO_DELETE: Set<FolderFileCategory> = new Set([
  'extra-art',
  'extra-nfo',
  'unknown',
])

export const VIDEO_EXTS = new Set([
  '.mkv', '.mp4', '.avi', '.m4v', '.mov', '.ts', '.iso', '.m2ts', '.wmv',
])
export const SUBTITLE_EXTS = new Set([
  '.srt', '.sub', '.ass', '.ssa', '.vtt', '.idx', '.sup', '.mks',
])
export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

// All canonical artwork filenames that MediaDillo creates or preserves.
// Must stay in sync with KNOWN_ARTWORK in stale-detector.ts.
export const CANONICAL_ART = new Set([
  'poster.jpg', 'poster.jpeg', 'poster.png',
  'backdrop.jpg', 'backdrop.jpeg', 'backdrop.png',
  'fanart.jpg', 'fanart.jpeg', 'fanart.png',
  'thumb.jpg', 'thumb.jpeg', 'thumb.png',
  'banner.jpg', 'banner.jpeg', 'banner.png',
  'logo.jpg', 'logo.png',
  'clearart.png',
  'disc.png', 'discart.png',
  // legacy / Kodi alias kept for compatibility
  'folder.jpg',
])

const POSTER_SFX = ['-poster', '_poster']
const BACKDROP_SFX = [
  '-fanart', '_fanart', '-backdrop', '_backdrop',
  '-landscape', '_landscape', '-background', '_background',
]

/**
 * Classifies one file in a movie folder.
 *
 * @param name              the file's basename, as it appears on disk
 * @param isKnownVideo      true when the path is already a MovieFile row
 * @param canonicalNfoName  "<Title> (Year).nfo" for this movie
 */
export function categorizeFolderFile(
  name: string,
  isKnownVideo: boolean,
  canonicalNfoName: string
): FolderFileCategory {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot > 0 ? lower.slice(dot) : ''
  const base = dot > 0 ? lower.slice(0, dot) : lower

  if (isKnownVideo) return 'video'
  if (VIDEO_EXTS.has(ext)) return 'unknown-video'
  if (CANONICAL_ART.has(lower)) return 'artwork'
  if (IMAGE_EXTS.has(ext)) {
    const suffixed =
      POSTER_SFX.some((s) => base.endsWith(s)) || BACKDROP_SFX.some((s) => base.endsWith(s))
    return suffixed ? 'extra-art' : 'unknown'
  }
  if (SUBTITLE_EXTS.has(ext)) return 'subtitle'
  if (ext === '.nfo') return name === 'movie.nfo' || name === canonicalNfoName ? 'nfo' : 'extra-nfo'
  return 'unknown'
}

import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Sidecar recognition and migration.
 *
 * Kept free of database imports so the rules can be unit-tested directly: a file
 * being misclassified here either strands artwork during a rename or proposes a real
 * subtitle for deletion, so these predicates need tests of their own.
 */

// Bare Kodi/Jellyfin artwork and metadata filenames. These carry no "-logo" style
// suffix, so ARTWORK_SUFFIXES cannot match them and they must be listed explicitly.
// Both the .jpg and .png spellings are included because the artwork writer picks the
// extension from the source image, not from the artwork type.
export const KNOWN_FILENAMES = new Set([
  'poster.jpg',
  'poster.png',
  'backdrop.jpg',
  'backdrop.png',
  'fanart.jpg',
  'fanart.png',
  'thumb.jpg',
  'thumb.png',
  'folder.jpg',
  'folder.png',
  'landscape.jpg',
  'landscape.png',
  'logo.jpg',
  'logo.png',
  'logo.svg',
  'clearlogo.jpg',
  'clearlogo.png',
  'clearart.jpg',
  'clearart.png',
  'banner.jpg',
  'banner.png',
  'disc.jpg',
  'disc.png',
  'discart.jpg',
  'discart.png',
  'keyart.jpg',
  'keyart.png',
  'characterart.jpg',
  'characterart.png',
  'movie.nfo',
  'tvshow.nfo',
])

// Sidecar extensions that travel with a video. Subtitle formats are listed in full:
// .idx/.sub are a VobSub pair, .sup is PGS, .mks is a Matroska subtitle container.
export const KNOWN_EXTENSIONS = new Set([
  '.nfo',
  '.srt',
  '.sub',
  '.idx',
  '.sup',
  '.ass',
  '.ssa',
  '.vtt',
  '.mks',
])

export const VIDEO_EXTENSIONS = new Set([
  '.mkv',
  '.mp4',
  '.avi',
  '.m4v',
  '.mov',
  '.wmv',
  '.ts',
  '.mpg',
  '.mpeg',
])

// TMM artwork suffix patterns, e.g. "<title>-logo.png"
const ARTWORK_SUFFIXES = [
  '-poster', '_poster', '-fanart', '_fanart', '-landscape', '_landscape',
  '-backdrop', '_backdrop', '-background', '_background', '-clearart', '_clearart',
  '-discart', '_discart', '-logo', '_logo', '-banner', '_banner', '-thumb', '_thumb',
]

/**
 * True when `filename` is a sidecar that belongs beside a video file.
 *
 * Used both to decide what follows a video on rename and to decide what is NOT stale,
 * so the two can never disagree about the same file.
 */
export function isSidecarFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  if (KNOWN_FILENAMES.has(lower)) return true
  const ext = path.extname(lower)
  if (KNOWN_EXTENSIONS.has(ext)) return true
  const base = lower.slice(0, lower.length - ext.length)
  if (ARTWORK_SUFFIXES.some((s) => base.endsWith(s))) return true
  return false
}

/**
 * Renames a sidecar so it keeps pairing with its video after the video is renamed.
 *
 * A sidecar prefixed with the old video basename (`Old Title (1999).eng.srt`,
 * `Old Title (1999)-thumb.jpg`) has that prefix swapped for the new basename, which
 * preserves everything that follows — the language tag, the artwork suffix, the
 * extension. Media players pair subtitles by basename, so without this the subtitle
 * silently stops being offered for the film.
 *
 * Bare sidecars (`poster.jpg`, `movie.nfo`) carry no basename and are returned as-is,
 * as are sidecars belonging to a different video in a multi-file folder.
 */
export function retargetSidecarName(entry: string, oldBase: string, newBase: string): string {
  if (!oldBase || oldBase === newBase) return entry
  if (!entry.startsWith(oldBase)) return entry
  return newBase + entry.slice(oldBase.length)
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Moves sidecar files from a movie's old folder to its new one.
 *
 * `oldBase`/`newBase` are the video filenames without extension, used to keep
 * basename-prefixed sidecars paired with their video.
 *
 * A sidecar never overwrites a file already present in the destination: the
 * destination copy is the current one (the artwork writer has already run there),
 * while the source is left over from the previous layout.
 */
export async function migrateSidecars(
  oldFolder: string,
  newFolder: string,
  oldBase = '',
  newBase = ''
): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(oldFolder)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!isSidecarFile(entry)) continue
    const src = path.join(oldFolder, entry)
    const dst = path.join(newFolder, retargetSidecarName(entry, oldBase, newBase))
    try {
      // fs.rename overwrites silently, so check first. Not using link()+unlink() for
      // exclusive-create: the library lives on a CIFS mount where hardlinks are not
      // reliably supported, and a failure there would strand every sidecar.
      if (await exists(dst)) continue
      await fs.rename(src, dst)
    } catch {
      // Non-fatal per-file failure. The source stays put and the old folder is left
      // for the caller to deal with.
    }
  }
}

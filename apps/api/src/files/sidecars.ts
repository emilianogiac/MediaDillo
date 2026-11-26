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

/**
 * Extensions that count as a sidecar once the name already matches a video's basename.
 *
 * Wider than isSidecarFile on purpose. That predicate has to judge a filename in
 * isolation, so it only accepts artwork it can recognise by name ("poster.jpg") or by
 * suffix ("<title>-thumb.jpg"). Here the prefix match against the video's basename is
 * itself the proof of association, so the common Kodi/TMM episode thumbnail
 * "<episode basename>.jpg" — which carries neither marker — must also qualify
 * (issue #86).
 */
const EPISODE_SIDECAR_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.tbn',
])

function belongsToEpisode(entry: string): boolean {
  if (isSidecarFile(entry)) return true
  const dot = entry.lastIndexOf('.')
  if (dot <= 0) return false
  return EPISODE_SIDECAR_EXTENSIONS.has(entry.slice(dot).toLowerCase())
}

/**
 * Moves the sidecars belonging to one renamed video file.
 *
 * Differs from migrateSidecars, which moves a whole movie folder's sidecars: an episode
 * shares its directory with every other episode of the season, so only files named
 * after *this* video may move, and the basename changes too (issue #82).
 *
 * Returns the number of sidecars moved.
 */
export async function migrateEpisodeSidecars(
  oldDir: string,
  newDir: string,
  oldBase: string,
  newBase: string
): Promise<number> {
  if (!oldBase) return 0
  let entries: string[]
  try {
    entries = await fs.readdir(oldDir)
  } catch {
    return 0
  }
  let moved = 0
  for (const entry of entries) {
    // Only this episode's sidecars — the directory holds the whole season.
    if (!entry.startsWith(oldBase)) continue
    if (entry === oldBase) continue
    if (!belongsToEpisode(entry)) continue
    const src = path.join(oldDir, entry)
    const dst = path.join(newDir, retargetSidecarName(entry, oldBase, newBase))
    if (src === dst) continue
    try {
      if (await exists(dst)) continue
      await fs.rename(src, dst)
      moved++
    } catch {
      // Non-fatal: the sidecar stays put rather than the rename failing.
    }
  }
  return moved
}

/** Removes a directory when it has become empty. Used to retire old season folders. */
export async function removeIfEmpty(dir: string): Promise<boolean> {
  try {
    const left = await fs.readdir(dir)
    if (left.length > 0) return false
    await fs.rmdir(dir)
    return true
  } catch {
    return false
  }
}

/**
 * Moves whatever remains in an emptied season directory to its replacement.
 *
 * Season-level artwork (`folder.jpg`, `season.nfo`, `season01-banner.jpg`, …) belongs
 * to the season rather than to any episode, so it matches no episode basename and
 * migrateEpisodeSidecars cannot claim it. Without this the old `s01/` directory
 * survives a conversion to `Season 01/` holding orphaned artwork (issue #88).
 *
 * Refuses to act while any video remains, so a partially-converted season is never
 * stripped of its artwork.
 */
export async function migrateSeasonFolderLeftovers(
  oldDir: string,
  newDir: string
): Promise<number> {
  if (oldDir === newDir) return 0
  let entries: string[]
  try {
    entries = await fs.readdir(oldDir)
  } catch {
    return 0
  }
  const hasVideo = entries.some((e) => VIDEO_EXTENSIONS.has(path.extname(e).toLowerCase()))
  if (hasVideo) return 0

  let moved = 0
  for (const entry of entries) {
    const src = path.join(oldDir, entry)
    const dst = path.join(newDir, entry)
    try {
      const st = await fs.stat(src)
      if (!st.isFile()) continue
      if (await exists(dst)) continue
      await fs.rename(src, dst)
      moved++
    } catch {
      // leave it; the directory simply will not be removed
    }
  }
  return moved
}

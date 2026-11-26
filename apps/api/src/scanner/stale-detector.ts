import path from 'node:path'
import { listFolderFiles } from './walker.js'

// Files we consider "known good" in any item folder
const KNOWN_ARTWORK = new Set([
  'poster.jpg', 'poster.jpeg', 'poster.png',
  'backdrop.jpg', 'backdrop.jpeg', 'backdrop.png',
  'fanart.jpg', 'fanart.jpeg', 'fanart.png',
  'thumb.jpg', 'thumb.jpeg', 'thumb.png',
  'banner.jpg', 'banner.jpeg', 'banner.png',
  'logo.jpg', 'logo.png',
  'clearart.png', 'clearart.jpg',
  'clearlogo.png', 'clearlogo.jpg',
  'characterart.png', 'characterart.jpg',
  'keyart.jpg', 'keyart.png',
  'landscape.jpg', 'landscape.jpeg', 'landscape.png',
  'disc.png', 'discart.png',
  // Kodi/Jellyfin alias for the poster — present on most folders in a TMM-era library
  'folder.jpg', 'folder.jpeg', 'folder.png',
])

// Season artwork lives beside the episodes: season01.jpg, season01-poster.jpg,
// season-specials-thumb.jpg, season-all-fanart.jpg, …
const SEASON_ARTWORK_RE =
  /^season(?:\d+|-all|-specials)?(?:-(?:poster|banner|thumb|fanart|landscape))?\.(?:jpg|jpeg|png)$/i

// Extra backdrops numbered by the scraper: fanart1.jpg, fanart2.jpg, …
const NUMBERED_FANART_RE = /^fanart\d+\.(?:jpg|jpeg|png)$/i

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

/**
 * True when `basename` is the artwork for a video sitting in the same folder.
 *
 * Kodi and TMM write the episode thumbnail as `<video basename>.jpg`, Jellyfin as
 * `<video basename>-thumb.jpg`. Neither carries a marker that identifies it in
 * isolation, so without comparing against the folder's videos both look like junk —
 * which is how 9,611 episode thumbnails came to be flagged for deletion (issue #92).
 */
function isEpisodeArtwork(basename: string, videoBasenames: Set<string>): boolean {
  const dot = basename.lastIndexOf('.')
  if (dot <= 0) return false
  if (!IMAGE_EXTENSIONS.has(basename.slice(dot).toLowerCase())) return false
  const stem = basename.slice(0, dot)
  if (videoBasenames.has(stem)) return true
  return stem.endsWith('-thumb') && videoBasenames.has(stem.slice(0, -'-thumb'.length))
}

// Canonical NFO filenames created by MediaDillo.
// Any .nfo whose basename is NOT in this set was created by another tool (TMM, Kodi, etc.)
// and should be flagged as stale when the corresponding canonical NFO already exists.
const CANONICAL_NFO = new Set([
  'movie.nfo', 'tvshow.nfo', 'episode.nfo',
])

// Subtitle sidecars. Single source of truth: a format missing here falls all the way
// through detectStaleFiles to "unrecognized file" and gets flagged for deletion.
// .idx/.sub are a VobSub pair, .sup is PGS, .mks is a Matroska subtitle container.
const SUBTITLE_EXTENSIONS = new Set([
  '.srt', '.sub', '.idx', '.sup', '.ass', '.ssa', '.vtt', '.mks',
])

const KNOWN_EXTENSIONS = new Set([
  ...SUBTITLE_EXTENSIONS,
  // video — handled separately as the main file
  '.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.flv',
  '.ts', '.mpg', '.mpeg', '.m2ts', '.vob', '.iso',
])

// Extensions considered stale (old TMM, Kodi, etc.)
const STALE_EXTENSIONS = new Set([
  '.tbn', '.xml', '.txt', '.jpg0', '.db', '.nzb',
])

export interface StaleFileEntry {
  path: string
  reason: string
}

export async function detectStaleFiles(
  folderPath: string,
  knownVideoPaths: Set<string>,
): Promise<StaleFileEntry[]> {
  const fileList = await listFolderFiles(folderPath)
  const files = new Set(fileList.map((f) => f.toLowerCase()))
  const stale: StaleFileEntry[] = []

  // Basenames of every video in this folder, used to recognise episode artwork.
  const videoBasenames = new Set(
    fileList
      .filter((f) => KNOWN_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .filter((f) => !SUBTITLE_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .map((f) => path.basename(f, path.extname(f)).toLowerCase()),
  )

  for (const filePath of fileList) {
    const basename = path.basename(filePath).toLowerCase()
    const ext = path.extname(filePath).toLowerCase()

    // Known video file in our DB
    if (knownVideoPaths.has(filePath)) continue

    // Known artwork filenames (bare canonical names are always kept)
    if (KNOWN_ARTWORK.has(basename)) continue
    if (SEASON_ARTWORK_RE.test(basename)) continue
    if (NUMBERED_FANART_RE.test(basename)) continue
    if (isEpisodeArtwork(basename, videoBasenames)) continue

    // TMM-style suffixed artwork (show-poster.jpg, show-fanart.jpg, etc.) — stale when a
    // canonical counterpart (poster.jpg / backdrop.jpg) already exists in the same folder.
    const artworkSuffixes = ['-poster', '_poster', '-fanart', '_fanart', '-backdrop', '_backdrop',
      '-landscape', '_landscape', '-banner', '_banner', '-clearart', '_clearart',
      '-discart', '_discart', '-disc', '_disc', '-logo', '_logo', '-thumb', '_thumb']
    const nameWithoutExt = basename.replace(/\.[^.]+$/, '')
    if (artworkSuffixes.some(s => nameWithoutExt.endsWith(s))) {
      // Determine which canonical file this TMM image corresponds to
      const suffix = artworkSuffixes.find(s => nameWithoutExt.endsWith(s))!
      const canonicalMap: Record<string, string[]> = {
        '-poster': ['poster.jpg', 'poster.jpeg', 'poster.png'],
        '_poster': ['poster.jpg', 'poster.jpeg', 'poster.png'],
        '-fanart': ['backdrop.jpg', 'backdrop.jpeg', 'backdrop.png', 'fanart.jpg', 'fanart.jpeg', 'fanart.png'],
        '_fanart': ['backdrop.jpg', 'backdrop.jpeg', 'backdrop.png', 'fanart.jpg', 'fanart.jpeg', 'fanart.png'],
        '-backdrop': ['backdrop.jpg', 'backdrop.jpeg', 'backdrop.png'],
        '_backdrop': ['backdrop.jpg', 'backdrop.jpeg', 'backdrop.png'],
        '-landscape': ['backdrop.jpg', 'backdrop.jpeg', 'backdrop.png'],
        '_landscape': ['backdrop.jpg', 'backdrop.jpeg', 'backdrop.png'],
        '-banner': ['banner.jpg', 'banner.jpeg', 'banner.png'],
        '_banner': ['banner.jpg', 'banner.jpeg', 'banner.png'],
        '-clearart': ['clearart.png'],
        '_clearart': ['clearart.png'],
        '-discart': ['disc.png', 'discart.png'],
        '_discart': ['disc.png', 'discart.png'],
        '-disc': ['disc.png', 'discart.png'],
        '_disc': ['disc.png', 'discart.png'],
        '-logo': ['logo.jpg', 'logo.png'],
        '_logo': ['logo.jpg', 'logo.png'],
        '-thumb': ['thumb.jpg', 'thumb.jpeg', 'thumb.png'],
        '_thumb': ['thumb.jpg', 'thumb.jpeg', 'thumb.png'],
      }
      const canonicals = canonicalMap[suffix] ?? []
      const dir = path.dirname(filePath)
      const hasCanonical = canonicals.some(c => files.has(path.join(dir, c).toLowerCase()))
      if (hasCanonical) {
        stale.push({ path: filePath, reason: 'stale file type (tmm artwork superseded by canonical)' })
      }
      // If no canonical exists, preserve the TMM file (it's the best we have)
      continue
    }

    // Canonical MediaDillo NFO filenames — always keep these
    if (CANONICAL_NFO.has(basename)) continue

    // Any other .nfo was created by a foreign tool (TMM, Kodi, etc.) — flag it as stale.
    // We prefer false negatives over false positives, so we only flag when a canonical
    // MediaDillo NFO already exists in the same folder (confirming MediaDillo has taken over).
    if (ext === '.nfo') {
      const dir = path.dirname(filePath)
      const hasCanonicalNfo = [...CANONICAL_NFO].some(n => files.has(path.join(dir, n).toLowerCase()))
      if (hasCanonicalNfo) {
        stale.push({ path: filePath, reason: 'non-canonical NFO (superseded by MediaDillo NFO)' })
      }
      // If no canonical NFO exists yet, preserve the foreign NFO
      continue
    }

    // Subtitle files
    if (SUBTITLE_EXTENSIONS.has(ext)) continue

    // Trailer files (*-trailer.*)
    if (basename.includes('-trailer.') || basename.includes('.trailer.')) continue

    // Video files not in DB (orphaned)
    if (KNOWN_EXTENSIONS.has(ext) && !knownVideoPaths.has(filePath)) {
      stale.push({ path: filePath, reason: 'video file not in library' })
      continue
    }

    // Explicitly stale extensions
    if (STALE_EXTENSIONS.has(ext)) {
      stale.push({ path: filePath, reason: `stale file type (${ext})` })
      continue
    }

    // Unknown files
    stale.push({ path: filePath, reason: 'unrecognized file' })
  }

  return stale
}

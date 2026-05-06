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
  'clearart.png',
  'disc.png', 'discart.png',
])

const KNOWN_METADATA = new Set([
  'movie.nfo', 'tvshow.nfo', 'episode.nfo',
])

const KNOWN_EXTENSIONS = new Set([
  // subtitles
  '.srt', '.sub', '.ass', '.ssa', '.vtt', '.idx',
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
  const files = await listFolderFiles(folderPath)
  const stale: StaleFileEntry[] = []

  for (const filePath of files) {
    const basename = path.basename(filePath).toLowerCase()
    const ext = path.extname(filePath).toLowerCase()

    // Known video file in our DB
    if (knownVideoPaths.has(filePath)) continue

    // Known artwork filenames (bare names or TMM-style {basename}-poster/-fanart etc.)
    if (KNOWN_ARTWORK.has(basename)) continue
    const artworkSuffixes = ['-poster', '_poster', '-fanart', '_fanart', '-backdrop', '_backdrop',
      '-landscape', '_landscape', '-banner', '_banner', '-clearart', '_clearart',
      '-discart', '_discart', '-disc', '_disc', '-logo', '_logo', '-thumb', '_thumb']
    const nameWithoutExt = basename.replace(/\.[^.]+$/, '')
    if (artworkSuffixes.some(s => nameWithoutExt.endsWith(s))) continue

    // Known metadata filenames
    if (KNOWN_METADATA.has(basename)) continue

    // NFO files (any *.nfo)
    if (ext === '.nfo') continue

    // Subtitle files
    if (['.srt', '.sub', '.ass', '.ssa', '.vtt', '.idx'].includes(ext)) continue

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

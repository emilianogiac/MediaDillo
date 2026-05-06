import path from 'node:path'
import { readdir } from 'node:fs/promises'

// Jellyfin-standard bare names
const POSTER_NAMES = new Set(['poster', 'folder'])
const BACKDROP_NAMES = new Set(['backdrop', 'fanart', 'background', 'art', 'extrafanart'])

// TMM-style suffixes appended to the video basename: Movie (2020)-poster.jpg
const POSTER_SUFFIXES = ['-poster', '_poster']
const BACKDROP_SUFFIXES = ['-fanart', '_fanart', '-backdrop', '_backdrop', '-landscape', '_landscape', '-background', '_background']

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export interface ArtworkPresence {
  hasPoster: boolean
  hasBackdrop: boolean
}

export async function detectLocalArtwork(folderPath: string): Promise<ArtworkPresence> {
  let files: string[]
  try {
    files = await readdir(folderPath)
  } catch {
    return { hasPoster: false, hasBackdrop: false }
  }

  let hasPoster = false
  let hasBackdrop = false

  for (const file of files) {
    const ext = path.extname(file).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue

    const base = path.basename(file, ext).toLowerCase()

    if (!hasPoster && (POSTER_NAMES.has(base) || POSTER_SUFFIXES.some(s => base.endsWith(s)))) {
      hasPoster = true
    }

    if (!hasBackdrop && (BACKDROP_NAMES.has(base) || BACKDROP_SUFFIXES.some(s => base.endsWith(s)))) {
      hasBackdrop = true
    }

    if (hasPoster && hasBackdrop) break
  }

  return { hasPoster, hasBackdrop }
}

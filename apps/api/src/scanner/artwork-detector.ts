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

async function listFolder(folderPath: string): Promise<string[]> {
  try {
    return await readdir(folderPath)
  } catch {
    return []
  }
}

export async function detectLocalArtwork(folderPath: string): Promise<ArtworkPresence> {
  const { posterPath, backdropPath } = await findArtworkPaths(folderPath)
  return { hasPoster: posterPath !== null, hasBackdrop: backdropPath !== null }
}

export async function findArtworkPaths(folderPath: string): Promise<{ posterPath: string | null; backdropPath: string | null }> {
  const files = await listFolder(folderPath)
  let posterPath: string | null = null
  let backdropPath: string | null = null

  for (const file of files) {
    const ext = path.extname(file).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue
    const base = path.basename(file, ext).toLowerCase()

    if (!posterPath && (POSTER_NAMES.has(base) || POSTER_SUFFIXES.some(s => base.endsWith(s)))) {
      posterPath = path.join(folderPath, file)
    }
    if (!backdropPath && (BACKDROP_NAMES.has(base) || BACKDROP_SUFFIXES.some(s => base.endsWith(s)))) {
      backdropPath = path.join(folderPath, file)
    }
    if (posterPath && backdropPath) break
  }

  return { posterPath, backdropPath }
}

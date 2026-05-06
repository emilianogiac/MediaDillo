import path from 'node:path'
import { readdir, stat } from 'node:fs/promises'

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

async function fileExistsOnDisk(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath)
    return s.isFile() && s.size > 0
  } catch {
    return false
  }
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
      const candidate = path.join(folderPath, file)
      // Verify the file actually exists and is non-empty on disk before claiming
      // it as valid artwork. readdir alone cannot detect zero-byte or deleted files
      // that still appear as directory entries (e.g. on some network filesystems).
      if (await fileExistsOnDisk(candidate)) {
        posterPath = candidate
      }
    }
    if (!backdropPath && (BACKDROP_NAMES.has(base) || BACKDROP_SUFFIXES.some(s => base.endsWith(s)))) {
      const candidate = path.join(folderPath, file)
      if (await fileExistsOnDisk(candidate)) {
        backdropPath = candidate
      }
    }
    if (posterPath && backdropPath) break
  }

  return { posterPath, backdropPath }
}

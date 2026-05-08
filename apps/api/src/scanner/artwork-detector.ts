import path from 'node:path'
import { readdir, stat } from 'node:fs/promises'

// Priority-ordered canonical names: poster wins over folder
const POSTER_PRIORITY = ['poster', 'folder']
const BACKDROP_PRIORITY = ['backdrop', 'fanart', 'background', 'art', 'extrafanart']

// TMM-style suffixes appended to the video basename: Movie (2020)-poster.jpg
const POSTER_SUFFIXES = ['-poster', '_poster']
const BACKDROP_SUFFIXES = ['-fanart', '_fanart', '-backdrop', '_backdrop', '-landscape', '_landscape', '-background', '_background']

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp']

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
  let posterPath: string | null = null
  let backdropPath: string | null = null

  // First pass: canonical names checked in explicit priority order (poster > folder).
  // Direct stat checks avoid any dependency on readdir alphabetical ordering.
  for (const name of POSTER_PRIORITY) {
    for (const ext of IMAGE_EXTS) {
      const candidate = path.join(folderPath, name + ext)
      if (await fileExistsOnDisk(candidate)) { posterPath = candidate; break }
    }
    if (posterPath) break
  }
  for (const name of BACKDROP_PRIORITY) {
    for (const ext of IMAGE_EXTS) {
      const candidate = path.join(folderPath, name + ext)
      if (await fileExistsOnDisk(candidate)) { backdropPath = candidate; break }
    }
    if (backdropPath) break
  }

  // Second pass: fall back to suffix-named files (TMM convention) if no canonical file found
  if (!posterPath || !backdropPath) {
    const files = await listFolder(folderPath)
    for (const file of files) {
      const ext = path.extname(file).toLowerCase()
      if (!IMAGE_EXTS.includes(ext)) continue
      const base = path.basename(file, ext).toLowerCase()

      if (!posterPath && POSTER_SUFFIXES.some(s => base.endsWith(s))) {
        const candidate = path.join(folderPath, file)
        if (await fileExistsOnDisk(candidate)) posterPath = candidate
      }
      if (!backdropPath && BACKDROP_SUFFIXES.some(s => base.endsWith(s))) {
        const candidate = path.join(folderPath, file)
        if (await fileExistsOnDisk(candidate)) backdropPath = candidate
      }
      if (posterPath && backdropPath) break
    }
  }

  return { posterPath, backdropPath }
}

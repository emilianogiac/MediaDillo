import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@mediadillo/db'
import { canonicalMovieFolderName } from './naming.js'
import {
  categorizeFolderFile,
  BATCH_SAFE_TO_DELETE,
  type FolderFileCategory,
} from './cleanup-categories.js'

export { BATCH_SAFE_TO_DELETE }
export type { FolderFileCategory }

export interface ScannedFolderFile {
  name: string
  path: string
  size: number
  category: FolderFileCategory
}

export interface ScannedFolder {
  folderPath: string
  files: ScannedFolderFile[]
}

export async function scanMovieFolder(movieId: string): Promise<ScannedFolder | null> {
  const movie = await prisma.movie.findUnique({
    where: { id: movieId },
    include: { files: { orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }] }, scanRoot: true },
  })
  if (!movie || !movie.files.length) return null

  const firstFile = movie.files[0]!
  const fileDir = path.dirname(firstFile.path)

  // Derive the movie folder safely: it must be a direct child of the scan root.
  // Heuristic dirname-walking is avoided to prevent operating on a parent that
  // contains multiple movies (or worse, the scan root itself).
  let folderPath: string
  const scanRootPath = movie.scanRoot?.path
  if (scanRootPath) {
    const rootPrefix = scanRootPath.endsWith('/') ? scanRootPath : scanRootPath + '/'
    if (fileDir.startsWith(rootPrefix)) {
      const relative = fileDir.slice(rootPrefix.length)
      const topLevelDir = relative.split('/')[0]!
      folderPath = topLevelDir ? path.join(scanRootPath, topLevelDir) : fileDir
    } else {
      // File is not under its own scan root — cannot determine safe folder
      return null
    }
  } else {
    // No scan root attached — use the file's immediate parent (best we can do)
    folderPath = fileDir
  }

  // Include ALL MovieFiles in this folder, not just those of the current movie record,
  // so that other editions/versions sharing the same folder are never flagged for deletion.
  const allFolderFiles = await prisma.movieFile.findMany({
    where: { path: { startsWith: folderPath + '/' } },
    select: { path: true },
  })
  const knownPaths = new Set(allFolderFiles.map((f) => f.path))
  const canonicalNfoName = `${canonicalMovieFolderName(movie.title, movie.year)}.nfo`

  let entries: string[]
  try {
    entries = await fs.readdir(folderPath)
  } catch {
    return null
  }

  const items = await Promise.all(entries.map(async (name): Promise<ScannedFolderFile | null> => {
    const fullPath = path.join(folderPath, name)
    let size = 0
    try {
      const s = await fs.stat(fullPath)
      if (!s.isFile()) return null
      size = s.size
    } catch { return null }

    const category = categorizeFolderFile(name, knownPaths.has(fullPath), canonicalNfoName)

    return { name, path: fullPath, size, category }
  }))

  return { folderPath, files: items.filter((f): f is ScannedFolderFile => f !== null) }
}

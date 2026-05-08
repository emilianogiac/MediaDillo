import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@mediadillo/db'
import { canonicalMovieFolderName } from './naming.js'

export type FolderFileCategory = 'video' | 'artwork' | 'subtitle' | 'nfo' | 'extra-art' | 'extra-nfo' | 'unknown'

export const BATCH_SAFE_TO_DELETE: Set<FolderFileCategory> = new Set([
  'extra-art',
  'extra-nfo',
  'subtitle',
  'unknown',
])

const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.ts', '.iso', '.m2ts', '.wmv'])
const SUBTITLE_EXTS = new Set(['.srt', '.sub', '.ass', '.ssa', '.vtt', '.idx', '.sup', '.mks'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const CANONICAL_ART = new Set(['poster.jpg', 'backdrop.jpg', 'folder.jpg'])
const POSTER_SFX = ['-poster', '_poster']
const BACKDROP_SFX = ['-fanart', '_fanart', '-backdrop', '_backdrop', '-landscape', '_landscape', '-background', '_background']

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
  const scanRootPath = movie.scanRoot?.path ?? ''
  const folderPath = scanRootPath && path.dirname(fileDir) !== scanRootPath
    ? path.dirname(fileDir)
    : fileDir

  const knownPaths = new Set(movie.files.map((f) => f.path))
  const canonicalNfoName = `${canonicalMovieFolderName(movie.title, movie.year)}.nfo`

  let entries: string[]
  try {
    entries = await fs.readdir(folderPath)
  } catch {
    return null
  }

  const items = await Promise.all(entries.map(async (name): Promise<ScannedFolderFile | null> => {
    const fullPath = path.join(folderPath, name)
    const ext = path.extname(name).toLowerCase()
    const base = path.basename(name, ext).toLowerCase()
    let size = 0
    try {
      const s = await fs.stat(fullPath)
      if (!s.isFile()) return null
      size = s.size
    } catch { return null }

    let category: FolderFileCategory
    if (knownPaths.has(fullPath)) {
      category = 'video'
    } else if (VIDEO_EXTS.has(ext)) {
      category = 'unknown'
    } else if (CANONICAL_ART.has(name.toLowerCase())) {
      category = 'artwork'
    } else if (IMAGE_EXTS.has(ext)) {
      category = (POSTER_SFX.some((s) => base.endsWith(s)) || BACKDROP_SFX.some((s) => base.endsWith(s)))
        ? 'extra-art' : 'unknown'
    } else if (SUBTITLE_EXTS.has(ext)) {
      category = 'subtitle'
    } else if (ext === '.nfo') {
      category = (name === 'movie.nfo' || name === canonicalNfoName) ? 'nfo' : 'extra-nfo'
    } else {
      category = 'unknown'
    }

    return { name, path: fullPath, size, category }
  }))

  return { folderPath, files: items.filter((f): f is ScannedFolderFile => f !== null) }
}

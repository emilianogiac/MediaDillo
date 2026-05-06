import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@mediadillo/db'
import {
  canonicalMovieFolderName,
  canonicalMovieFileName,
  canonicalSeasonFolderName,
  canonicalEpisodeFileName,
} from './naming.js'

export interface RenamePreviewItem {
  id: string
  type: 'movie-file' | 'episode-file'
  currentPath: string
  proposedPath: string
  needsRename: boolean
}

// ---------------------------------------------------------------------------
// Movie rename
// ---------------------------------------------------------------------------

export async function previewMovieRenames(movieIds?: string[]): Promise<RenamePreviewItem[]> {
  const movies = await prisma.movie.findMany({
    where: {
      status: 'owned',
      ...(movieIds && movieIds.length > 0 ? { id: { in: movieIds } } : {}),
    },
    include: { files: true, scanRoot: true },
  })

  const items: RenamePreviewItem[] = []

  for (const movie of movies) {
    if (!movie.scanRoot) continue

    const folderName = canonicalMovieFolderName(movie.title, movie.year)
    const folderPath = path.join(movie.scanRoot.path, folderName)

    for (const file of movie.files) {
      const ext = path.extname(file.path)
      const fileName = canonicalMovieFileName(movie.title, movie.year, ext)
      const proposedPath = path.join(folderPath, fileName)

      items.push({
        id: file.id,
        type: 'movie-file',
        currentPath: file.path,
        proposedPath,
        needsRename: file.path !== proposedPath,
      })
    }
  }

  return items
}

export async function applyMovieRenames(fileIds: string[]): Promise<{ renamed: number; errors: string[] }> {
  const files = await prisma.movieFile.findMany({
    where: { id: { in: fileIds } },
    include: { movie: { include: { scanRoot: true } } },
  })

  let renamed = 0
  const errors: string[] = []

  for (const file of files) {
    const { movie } = file
    if (!movie.scanRoot) {
      errors.push(`${file.path}: no scan root`)
      continue
    }

    const folderName = canonicalMovieFolderName(movie.title, movie.year)
    const folderPath = path.join(movie.scanRoot.path, folderName)
    const ext = path.extname(file.path)
    const fileName = canonicalMovieFileName(movie.title, movie.year, ext)
    const proposedPath = path.join(folderPath, fileName)

    if (file.path === proposedPath) continue

    try {
      await fs.mkdir(folderPath, { recursive: true })
      await fs.rename(file.path, proposedPath)
      await prisma.movieFile.update({ where: { id: file.id }, data: { path: proposedPath } })
      renamed++
    } catch (err) {
      errors.push(`${file.path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { renamed, errors }
}

// ---------------------------------------------------------------------------
// Episode rename
// ---------------------------------------------------------------------------

export async function previewEpisodeRenames(showIds?: string[]): Promise<RenamePreviewItem[]> {
  const whereClause =
    showIds && showIds.length > 0
      ? { status: 'owned' as const, season: { show: { id: { in: showIds } } } }
      : { status: 'owned' as const }

  const episodes = await prisma.episode.findMany({
    where: whereClause,
    include: {
      files: true,
      season: { include: { show: true } },
    },
  })

  const items: RenamePreviewItem[] = []

  for (const episode of episodes) {
    const { season } = episode
    const { show } = season

    for (const file of episode.files) {
      const ext = path.extname(file.path)
      const currentDir = path.dirname(file.path)
      const showDir = path.dirname(currentDir)
      const seasonFolder = canonicalSeasonFolderName(season.seasonNumber)
      const fileName = canonicalEpisodeFileName(
        show.title,
        season.seasonNumber,
        episode.episodeNumber,
        episode.title,
        ext,
      )
      const proposedPath = path.join(showDir, seasonFolder, fileName)

      items.push({
        id: file.id,
        type: 'episode-file',
        currentPath: file.path,
        proposedPath,
        needsRename: file.path !== proposedPath,
      })
    }
  }

  return items
}

export async function applyEpisodeRenames(fileIds: string[]): Promise<{ renamed: number; errors: string[] }> {
  const files = await prisma.episodeFile.findMany({
    where: { id: { in: fileIds } },
    include: {
      episode: {
        include: { season: { include: { show: true } } },
      },
    },
  })

  let renamed = 0
  const errors: string[] = []

  for (const file of files) {
    const { episode } = file
    const { season } = episode
    const { show } = season

    const ext = path.extname(file.path)
    const currentDir = path.dirname(file.path)
    const showDir = path.dirname(currentDir)
    const seasonFolder = canonicalSeasonFolderName(season.seasonNumber)
    const fileName = canonicalEpisodeFileName(
      show.title,
      season.seasonNumber,
      episode.episodeNumber,
      episode.title,
      ext,
    )
    const seasonPath = path.join(showDir, seasonFolder)
    const proposedPath = path.join(seasonPath, fileName)

    if (file.path === proposedPath) continue

    try {
      await fs.mkdir(seasonPath, { recursive: true })
      await fs.rename(file.path, proposedPath)
      await prisma.episodeFile.update({ where: { id: file.id }, data: { path: proposedPath } })
      renamed++
    } catch (err) {
      errors.push(`${file.path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { renamed, errors }
}

// ---------------------------------------------------------------------------
// Stale file cleanup
// ---------------------------------------------------------------------------

const KNOWN_FILENAMES = new Set([
  'poster.jpg',
  'backdrop.jpg',
  'fanart.jpg',
  'thumb.jpg',
  'folder.jpg',
  'movie.nfo',
  'tvshow.nfo',
])

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.mpg', '.mpeg'])

export async function detectStaleFilesForMovie(movieId: string): Promise<string[]> {
  const movie = await prisma.movie.findUnique({
    where: { id: movieId },
    include: { files: true, scanRoot: true },
  })
  if (!movie?.scanRoot) return []

  const folderName = canonicalMovieFolderName(movie.title, movie.year)
  const folderPath = path.join(movie.scanRoot.path, folderName)

  let entries: string[]
  try {
    entries = await fs.readdir(folderPath)
  } catch {
    // try current folder of first file
    const firstFile = movie.files[0]
    if (!firstFile) return []
    const currentDir = path.dirname(firstFile.path)
    try {
      entries = await fs.readdir(currentDir)
    } catch {
      return []
    }
  }

  const ownedPaths = new Set(movie.files.map((f) => path.basename(f.path)))
  const stale: string[] = []

  for (const entry of entries) {
    if (KNOWN_FILENAMES.has(entry.toLowerCase())) continue
    if (ownedPaths.has(entry)) continue
    const ext = path.extname(entry).toLowerCase()
    if (VIDEO_EXTENSIONS.has(ext)) continue
    stale.push(path.join(folderPath, entry))
  }

  return stale
}

export async function deleteToTrash(filePath: string): Promise<void> {
  const trashDir = path.join(path.dirname(filePath), '.trash')
  await fs.mkdir(trashDir, { recursive: true })
  const dest = path.join(trashDir, `${Date.now()}-${path.basename(filePath)}`)
  await fs.rename(filePath, dest)
}

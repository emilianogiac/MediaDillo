import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma, RenameTrigger } from '@mediadillo/db'

const RENAME_LOG_TTL_DAYS = 180

async function pruneExpiredRenameLogs(): Promise<void> {
  await prisma.renameLog.deleteMany({ where: { expiresAt: { lt: new Date() } } })
}

async function logRename(opts: {
  movieId: string | null
  fileId: string | null
  fromPath: string
  toPath: string
  trigger: RenameTrigger
}): Promise<void> {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + RENAME_LOG_TTL_DAYS)
  await prisma.renameLog.create({ data: { ...opts, expiresAt } })
}
import {
  canonicalMovieFolderName,
  canonicalMovieFileName,
  canonicalSeasonFolderName,
  canonicalEpisodeFileName,
} from './naming.js'

export interface RenamePreviewItem {
  id: string
  type: 'movie-file' | 'episode-file' | 'show-folder'
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
    include: { files: { orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }] }, scanRoot: true },
  })

  const items: RenamePreviewItem[] = []

  for (const movie of movies) {
    if (!movie.scanRoot) continue

    const folderName = canonicalMovieFolderName(movie.title, movie.year)
    const folderPath = path.join(movie.scanRoot.path, folderName)

    // Count files per edition group; only groups with >1 file need part numbers
    const editionGroupSize = new Map<string | null, number>()
    for (const f of movie.files) {
      const key = f.edition ?? null
      editionGroupSize.set(key, (editionGroupSize.get(key) ?? 0) + 1)
    }
    const editionGroupIndex = new Map<string | null, number>()

    for (const file of movie.files) {
      const key = file.edition ?? null
      const groupIdx = editionGroupIndex.get(key) ?? 0
      editionGroupIndex.set(key, groupIdx + 1)
      const partNumber = (editionGroupSize.get(key) ?? 1) > 1 ? groupIdx + 1 : null
      const ext = path.extname(file.path)
      const fileName = canonicalMovieFileName(movie.title, movie.year, ext, partNumber, file.edition ?? null, file.threeD ?? null)
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

export async function applyMovieRenames(
  fileIds: string[],
  trigger: RenameTrigger = RenameTrigger.manual,
): Promise<{ renamed: number; errors: string[] }> {
  await pruneExpiredRenameLogs()

  // Load files grouped by movie to resolve part numbers correctly
  const files = await prisma.movieFile.findMany({
    where: { id: { in: fileIds } },
    include: { movie: { include: { scanRoot: true, files: { orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }] } } } },
  })

  let renamed = 0
  const errors: string[] = []

  // Pre-compute edition group sizes per movie (keyed by movieId+edition)
  const movieEditionGroupSize = new Map<string, Map<string | null, number>>()
  for (const file of files) {
    const { movie } = file
    if (!movieEditionGroupSize.has(movie.id)) {
      const sizeMap = new Map<string | null, number>()
      for (const f of movie.files) {
        const key = f.edition ?? null
        sizeMap.set(key, (sizeMap.get(key) ?? 0) + 1)
      }
      movieEditionGroupSize.set(movie.id, sizeMap)
    }
  }
  // Track how many files per edition group we've already renamed (to assign part numbers)
  const movieEditionGroupIndex = new Map<string, Map<string | null, number>>()

  for (const file of files) {
    const { movie } = file
    if (!movie.scanRoot) {
      errors.push(`${file.path}: no scan root`)
      continue
    }

    const folderName = canonicalMovieFolderName(movie.title, movie.year)
    const folderPath = path.join(movie.scanRoot.path, folderName)
    const ext = path.extname(file.path)
    const editionKey = file.edition ?? null
    const sizeMap = movieEditionGroupSize.get(movie.id)!
    if (!movieEditionGroupIndex.has(movie.id)) movieEditionGroupIndex.set(movie.id, new Map())
    const indexMap = movieEditionGroupIndex.get(movie.id)!
    const groupIdx = indexMap.get(editionKey) ?? 0
    indexMap.set(editionKey, groupIdx + 1)
    const partNumber = (sizeMap.get(editionKey) ?? 1) > 1 ? groupIdx + 1 : null
    const fileName = canonicalMovieFileName(movie.title, movie.year, ext, partNumber, file.edition ?? null, file.threeD ?? null)
    const proposedPath = path.join(folderPath, fileName)

    if (file.path === proposedPath) continue

    const oldFolder = path.dirname(file.path)
    const newFolder = folderPath

    try {
      await fs.mkdir(newFolder, { recursive: true })
      await fs.rename(file.path, proposedPath)
      await prisma.movieFile.update({ where: { id: file.id }, data: { path: proposedPath } })
      await logRename({ movieId: movie.id, fileId: file.id, fromPath: file.path, toPath: proposedPath, trigger })
      renamed++

      // Migrate sidecars when the folder actually changed
      if (oldFolder !== newFolder) {
        await migrateSidecars(oldFolder, newFolder)
        // Remove old folder if now empty
        try { await fs.rmdir(oldFolder) } catch { /* non-empty or already gone */ }
      }
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
  const emittedShowFolders = new Set<string>() // showId → already emitted

  for (const episode of episodes) {
    const { season } = episode
    const { show } = season
    const fileCount = episode.files.length

    episode.files.forEach((file, fileIdx) => {
      const partNumber = fileCount > 1 ? fileIdx + 1 : null
      const ext = path.extname(file.path)
      const currentSeasonDir = path.dirname(file.path)
      const currentShowDir = path.dirname(currentSeasonDir)
      const parentDir = path.dirname(currentShowDir)

      // Emit a show-folder rename item once per show
      if (!emittedShowFolders.has(show.id)) {
        emittedShowFolders.add(show.id)
        const canonicalShowDir = path.join(parentDir, canonicalMovieFolderName(show.title, show.year))
        if (currentShowDir !== canonicalShowDir) {
          items.push({
            id: show.id,
            type: 'show-folder',
            currentPath: currentShowDir,
            proposedPath: canonicalShowDir,
            needsRename: true,
          })
        }
      }

      const seasonFolder = canonicalSeasonFolderName(season.seasonNumber)
      const fileName = canonicalEpisodeFileName(
        show.title,
        season.seasonNumber,
        episode.episodeNumber,
        episode.title,
        ext,
        file.multiEpisodeEnd ?? null,
        partNumber,
      )
      const proposedPath = path.join(currentShowDir, seasonFolder, fileName)

      items.push({
        id: file.id,
        type: 'episode-file',
        currentPath: file.path,
        proposedPath,
        needsRename: file.path !== proposedPath,
      })
    })
  }

  return items
}

export async function previewEpisodeFileRenames(episodeFileIds: string[]): Promise<RenamePreviewItem[]> {
  if (episodeFileIds.length === 0) return []

  const files = await prisma.episodeFile.findMany({
    where: { id: { in: episodeFileIds } },
    include: {
      episode: {
        include: {
          files: { orderBy: { path: 'asc' } },
          season: { include: { show: true } },
        },
      },
    },
    orderBy: { path: 'asc' },
  })

  const items: RenamePreviewItem[] = []
  const emittedShowFolders = new Set<string>()

  for (const file of files) {
    const { episode } = file
    const { season } = episode
    const { show } = season

    const ext = path.extname(file.path)
    const currentSeasonDir = path.dirname(file.path)
    const currentShowDir = path.dirname(currentSeasonDir)
    const parentDir = path.dirname(currentShowDir)

    if (!emittedShowFolders.has(show.id)) {
      emittedShowFolders.add(show.id)
      const canonicalShowDir = path.join(parentDir, canonicalMovieFolderName(show.title, show.year))
      if (currentShowDir !== canonicalShowDir) {
        items.push({ id: show.id, type: 'show-folder', currentPath: currentShowDir, proposedPath: canonicalShowDir, needsRename: true })
      }
    }

    // Part number: position of this file among all files for this episode
    const allEpFiles = episode.files
    const fileCount = allEpFiles.length
    const fileIdx = allEpFiles.findIndex((f) => f.id === file.id)
    const partNumber = fileCount > 1 ? fileIdx + 1 : null

    const seasonFolder = canonicalSeasonFolderName(season.seasonNumber)
    const fileName = canonicalEpisodeFileName(
      show.title,
      season.seasonNumber,
      episode.episodeNumber,
      episode.title,
      ext,
      file.multiEpisodeEnd ?? null,
      partNumber,
    )
    const proposedPath = path.join(currentShowDir, seasonFolder, fileName)

    items.push({ id: file.id, type: 'episode-file', currentPath: file.path, proposedPath, needsRename: file.path !== proposedPath })
  }

  return items
}

export async function applyEpisodeRenames(
  fileIds: string[],
  showFolderItems?: RenamePreviewItem[],
): Promise<{ renamed: number; errors: string[] }> {
  let renamed = 0
  const errors: string[] = []

  // Track show folder remaps so episode file paths can be corrected below
  const showFolderMap = new Map<string, string>() // oldShowDir → newShowDir

  // Step 1: rename show folders first
  if (showFolderItems && showFolderItems.length > 0) {
    for (const item of showFolderItems) {
      if (item.currentPath === item.proposedPath) continue
      try {
        await fs.rename(item.currentPath, item.proposedPath)
        showFolderMap.set(item.currentPath, item.proposedPath)
        renamed++

        // Migrate show-level sidecars (poster, backdrop, tvshow.nfo) — already moved by folder rename
        // Update all EpisodeFile paths for this show in DB via prefix replacement
        const showDirOld = item.currentPath
        const showDirNew = item.proposedPath
        const affectedFiles = await prisma.episodeFile.findMany({
          where: { path: { startsWith: showDirOld + '/' } },
          select: { id: true, path: true },
        })
        for (const ef of affectedFiles) {
          const updatedPath = showDirNew + ef.path.slice(showDirOld.length)
          await prisma.episodeFile.update({ where: { id: ef.id }, data: { path: updatedPath } })
        }
      } catch (err) {
        errors.push(`folder ${item.currentPath}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Step 2: rename individual episode files
  const files = await prisma.episodeFile.findMany({
    where: { id: { in: fileIds } },
    include: {
      episode: {
        include: { season: { include: { show: true } } },
      },
    },
  })

  for (const file of files) {
    const { episode } = file
    const { season } = episode
    const { show } = season

    // File path may have been updated in step 1 — re-read from DB
    const currentPath = file.path
    const ext = path.extname(currentPath)
    const currentSeasonDir = path.dirname(currentPath)
    // Determine actual show dir after any folder rename
    let showDir = path.dirname(currentSeasonDir)
    // Apply remapping if this show dir was renamed
    for (const [old, updated] of showFolderMap) {
      if (showDir === old || showDir.startsWith(old + '/')) {
        showDir = updated + showDir.slice(old.length)
        break
      }
    }

    const seasonFolder = canonicalSeasonFolderName(season.seasonNumber)
    const fileName = canonicalEpisodeFileName(
      show.title,
      season.seasonNumber,
      episode.episodeNumber,
      episode.title,
      ext,
      file.multiEpisodeEnd ?? null,
    )
    const seasonPath = path.join(showDir, seasonFolder)
    const proposedPath = path.join(seasonPath, fileName)

    if (currentPath === proposedPath) continue

    try {
      await fs.mkdir(seasonPath, { recursive: true })
      await fs.rename(currentPath, proposedPath)
      await prisma.episodeFile.update({ where: { id: file.id }, data: { path: proposedPath } })
      renamed++
    } catch (err) {
      errors.push(`${currentPath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { renamed, errors }
}

// ---------------------------------------------------------------------------
// Stale file cleanup + sidecar patterns
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

const KNOWN_EXTENSIONS = new Set(['.nfo', '.srt', '.sub', '.ass', '.ssa'])

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.mpg', '.mpeg'])

// TMM artwork suffix patterns
const ARTWORK_SUFFIXES = [
  '-poster', '_poster', '-fanart', '_fanart', '-landscape', '_landscape',
  '-backdrop', '_backdrop', '-background', '_background', '-clearart', '_clearart',
  '-discart', '_discart', '-logo', '_logo', '-banner', '_banner', '-thumb', '_thumb',
]

function isSidecarFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  if (KNOWN_FILENAMES.has(lower)) return true
  const ext = path.extname(lower)
  if (KNOWN_EXTENSIONS.has(ext)) return true
  const base = lower.slice(0, lower.length - ext.length)
  if (ARTWORK_SUFFIXES.some((s) => base.endsWith(s))) return true
  return false
}

async function migrateSidecars(oldFolder: string, newFolder: string): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(oldFolder)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!isSidecarFile(entry)) continue
    const src = path.join(oldFolder, entry)
    const dst = path.join(newFolder, entry)
    try {
      await fs.rename(src, dst)
    } catch {
      // non-fatal per-file failure
    }
  }
}

export async function revertRenameLog(logId: string): Promise<{ ok: boolean; error?: string }> {
  const entry = await prisma.renameLog.findUnique({ where: { id: logId } })
  if (!entry) return { ok: false, error: 'Log entry not found' }
  if (!entry.fileId) return { ok: false, error: 'No file associated with this log entry' }

  const { fromPath, toPath, fileId, movieId } = entry

  try {
    await fs.access(toPath)
  } catch {
    return { ok: false, error: 'File not found at expected location — may have already been moved' }
  }

  try {
    await fs.mkdir(path.dirname(fromPath), { recursive: true })
    await fs.rename(toPath, fromPath)
    await prisma.movieFile.update({ where: { id: fileId }, data: { path: fromPath } })
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + RENAME_LOG_TTL_DAYS)
    await prisma.renameLog.create({
      data: { movieId, fileId, fromPath: toPath, toPath: fromPath, trigger: RenameTrigger.manual, expiresAt },
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

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
    if (KNOWN_EXTENSIONS.has(ext)) continue
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

import path from 'node:path'
import { prisma } from '@mediadillo/db'
import type { ScanRootConfig } from '../config.js'
import { walkRoot, walkMovieFolders } from './walker.js'
import { parseFilename } from './filename-parser.js'
import { extractTechSpecs } from './ffprobe.js'
import { detectStaleFiles } from './stale-detector.js'
import { syncMovieFolder, syncMovieFile, syncEpisodeFile, writeScanLog, pruneOrphanedFiles } from './db-sync.js'
import type { ScanCounts } from './db-sync.js'
import type { ScanSummary } from './types.js'

let scanning = false

export interface ScanProgress {
  scanning: boolean
  filesProcessed: number
  filesFound: number
  currentFile: string | null
  startedAt: string | null
}

const progress: ScanProgress = {
  scanning: false,
  filesProcessed: 0,
  filesFound: 0,
  currentFile: null,
  startedAt: null,
}

export function isScanRunning(): boolean {
  return scanning
}

export function getScanProgress(): ScanProgress {
  return { ...progress }
}

export async function runScan(scanRoots: ScanRootConfig[]): Promise<ScanSummary> {
  if (scanning) throw new Error('A scan is already running')
  scanning = true
  progress.scanning = true
  progress.filesProcessed = 0
  progress.filesFound = 0
  progress.currentFile = null
  progress.startedAt = new Date().toISOString()

  const startTime = Date.now()
  let added = 0
  let changed = 0
  let removed = 0
  const allStaleFiles: Array<{ path: string; reason: string }> = []
  const rootsScanned: string[] = []

  try {
    for (const rootConfig of scanRoots) {
      if (!rootConfig.path) continue
      rootsScanned.push(rootConfig.path)

      // Find or create the ScanRoot DB record
      let scanRoot = await prisma.scanRoot.findFirst({ where: { path: rootConfig.path } })
      if (!scanRoot) {
        scanRoot = await prisma.scanRoot.create({
          data: { path: rootConfig.path, label: rootConfig.label, type: rootConfig.type },
        })
      }

      // Track video paths seen in this scan for stale detection
      const seenVideoPaths = new Set<string>()
      // Track which folders we've visited for stale detection
      const visitedFolders = new Set<string>()

      if (rootConfig.type === 'tv') {
        // TV: file-level walk → episode sync
        for await (const walkedFile of walkRoot(rootConfig.path)) {
          seenVideoPaths.add(walkedFile.path)
          progress.filesFound++
          progress.currentFile = walkedFile.path

          const folderPath = path.join(rootConfig.path, walkedFile.parentFolder)
          visitedFolders.add(folderPath)

          const parsed = parseFilename(walkedFile.path)
          if (parsed.type !== 'tv') {
            console.warn(`Skipping unrecognised TV file (no S/E pattern): ${walkedFile.path}`)
            progress.filesProcessed++
            continue
          }
          const techSpecs = await extractTechSpecs(walkedFile.path)
          const scannedFile = { path: walkedFile.path, sizeBytes: walkedFile.sizeBytes, mtimeMs: walkedFile.mtimeMs, parsed, techSpecs }
          try {
            const result = await syncEpisodeFile(scannedFile)
            if (result === 'added') added++
            else if (result === 'changed') changed++
          } catch (err) {
            console.error(`Failed to sync ${walkedFile.path}:`, err)
          }
          progress.filesProcessed++
        }
      } else {
        // Movies: folder-level walk → one Movie per folder
        for await (const { folderPath, files } of walkMovieFolders(rootConfig.path)) {
          visitedFolders.add(folderPath)
          for (const f of files) seenVideoPaths.add(f.path)
          progress.filesFound += files.length
          progress.currentFile = folderPath
          try {
            const counts = await syncMovieFolder(folderPath, files, scanRoot.id)
            added += counts.added
            changed += counts.changed
          } catch (err) {
            console.error(`Failed to sync movie folder ${folderPath}:`, err)
          }
          progress.filesProcessed += files.length
        }
      }

      // Stale file detection — check each visited folder
      for (const folder of visitedFolders) {
        const stale = await detectStaleFiles(folder, seenVideoPaths)
        allStaleFiles.push(...stale)
      }

      // Remove DB records for files that no longer exist on disk
      removed += await pruneOrphanedFiles(scanRoot.id, scanRoot.path, rootConfig.type, seenVideoPaths)
    }

    const scanLogId = await writeScanLog(null, rootsScanned, { added, changed, removed }, allStaleFiles)

    return {
      scanLogId,
      filesAdded: added,
      filesChanged: changed,
      filesRemoved: removed,
      staleFilesFound: allStaleFiles.length,
      durationMs: Date.now() - startTime,
    }
  } finally {
    scanning = false
    progress.scanning = false
    progress.currentFile = null
  }
}

export async function runSeasonScan(showId: string, seasonNumber: number): Promise<ScanCounts> {
  if (scanning) throw new Error('A full scan is already running')

  // Derive season folder from any existing episode file in this season
  const anyFile = await prisma.episodeFile.findFirst({
    where: { episode: { season: { showId, seasonNumber } } },
    select: { path: true },
  })
  if (!anyFile) return { added: 0, changed: 0, removed: 0 }

  const seasonFolderPath = path.dirname(anyFile.path)

  let added = 0
  let changed = 0
  const seenPaths = new Set<string>()

  for await (const walkedFile of walkRoot(seasonFolderPath)) {
    seenPaths.add(walkedFile.path)
    const parsed = parseFilename(walkedFile.path)
    if (parsed.type !== 'tv') continue

    const techSpecs = await extractTechSpecs(walkedFile.path)
    try {
      const result = await syncEpisodeFile({ path: walkedFile.path, sizeBytes: walkedFile.sizeBytes, mtimeMs: walkedFile.mtimeMs, parsed, techSpecs })
      if (result === 'added') added++
      else if (result === 'changed') changed++
    } catch (err) {
      console.error(`Season scan: failed to sync ${walkedFile.path}:`, err)
    }
  }

  // Prune episode files in this season folder that were not seen
  const dbFiles = await prisma.episodeFile.findMany({
    where: { path: { startsWith: seasonFolderPath + '/' } },
    select: { id: true, path: true, episodeId: true },
  })
  const orphaned = dbFiles.filter((f) => !seenPaths.has(f.path))
  let removed = 0

  if (orphaned.length > 0) {
    await prisma.episodeFile.deleteMany({ where: { id: { in: orphaned.map((f) => f.id) } } })

    const affectedEpisodeIds = [...new Set(orphaned.map((f) => f.episodeId))]
    for (const episodeId of affectedEpisodeIds) {
      const remaining = await prisma.episodeFile.count({ where: { episodeId } })
      if (remaining === 0) {
        await prisma.episode.update({ where: { id: episodeId }, data: { status: 'missing' } })
        removed++
      }
    }

    // Recalculate owned count for the show
    const owned = await prisma.episode.count({ where: { season: { showId }, status: 'owned' } })
    await prisma.tvShow.update({ where: { id: showId }, data: { ownedEpisodes: owned } })
  }

  return { added, changed, removed }
}

export async function runMovieFolderScan(movieId: string): Promise<ScanCounts> {
  if (scanning) throw new Error('A full scan is already running')

  const movie = await prisma.movie.findUnique({
    where: { id: movieId },
    include: { files: { take: 1 }, scanRoot: true },
  })
  if (!movie || !movie.scanRoot) return { added: 0, changed: 0, removed: 0 }

  // Derive folder from first file path
  const firstFile = movie.files[0]
  if (!firstFile) return { added: 0, changed: 0, removed: 0 }

  const folderPath = path.dirname(firstFile.path)

  // Collect all video files in the folder (recursive, same as walkMovieFolders internals)
  const files = []
  for await (const f of walkRoot(folderPath)) {
    files.push(f)
  }

  const counts = await syncMovieFolder(folderPath, files, movie.scanRootId!)

  // Prune MovieFiles for this movie whose path no longer exists on disk
  const seenPaths = new Set(files.map((f) => f.path))
  const dbFiles = await prisma.movieFile.findMany({
    where: { movieId },
    select: { id: true, path: true },
  })
  const orphaned = dbFiles.filter((f) => !seenPaths.has(f.path))
  if (orphaned.length > 0) {
    await prisma.movieFile.deleteMany({ where: { id: { in: orphaned.map((f) => f.id) } } })
    counts.removed += orphaned.length
  }

  return counts
}

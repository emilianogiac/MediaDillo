import path from 'node:path'
import fs from 'node:fs/promises'
import { prisma } from '@mediadillo/db'
import type { ScanRootConfig } from '../config.js'
import { walkRoot, walkMovieFolders } from './walker.js'
import { parseFilename } from './filename-parser.js'
import { extractTechSpecs } from './ffprobe.js'
import { detectStaleFiles } from './stale-detector.js'
import { syncMovieFolder, syncMovieFile, syncEpisodeFile, writeScanLog, pruneOrphanedFiles } from './db-sync.js'
import type { ScanCounts } from './db-sync.js'
import type { ScanSummary } from './types.js'
import { logActivity } from '../activity/log.js'

export interface SeasonScanResult extends ScanCounts {
  filesFound: number
  filesSkipped: { path: string; reason: string }[]
  folderFound: boolean
  _debug?: { seasonFolderPath: string; scanRootPath: string }
}

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

      // Verify root is accessible before walking — skip pruning if it's not.
      // readDirSafe swallows all errors, so we must check the root explicitly
      // to avoid pruning the entire library when the NAS is temporarily offline.
      let rootAccessible = false
      try {
        await fs.access(rootConfig.path)
        rootAccessible = true
      } catch {
        console.warn(`[scan] root not accessible, skipping prune: ${rootConfig.path}`)
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
            const result = await syncEpisodeFile(scannedFile, rootConfig.path)
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

      // Remove DB records for files that no longer exist on disk.
      // Skip if the root was inaccessible (seenVideoPaths would be empty/partial,
      // which would incorrectly prune the entire library).
      if (rootAccessible && seenVideoPaths.size > 0) {
        removed += await pruneOrphanedFiles(scanRoot.id, scanRoot.path, rootConfig.type, seenVideoPaths)
      }
    }

    const scanLogId = await writeScanLog(null, rootsScanned, { added, changed, removed }, allStaleFiles)

    await logActivity({
      action: 'scan_complete',
      detail: {
        filesAdded: added,
        filesRemoved: removed,
        filesChanged: changed,
        rootsScanned,
        scanLogId,
      },
    }).catch(() => {})

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

// Find a season folder on disk given a show root folder and season number.
// Tries common naming patterns: "Season 1", "Season 01", "S01", "s1", etc.
async function findSeasonFolder(showFolder: string, seasonNumber: number): Promise<string | null> {
  let entries: string[]
  try {
    const dirents = await fs.readdir(showFolder, { withFileTypes: true })
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return null
  }
  const n = seasonNumber
  const padded = String(n).padStart(2, '0')
  const candidates = [
    `Season ${n}`,
    `Season ${padded}`,
    `season ${n}`,
    `season ${padded}`,
    `S${padded}`,
    `s${padded}`,
    `S${n}`,
    `s${n}`,
  ]
  for (const candidate of candidates) {
    if (entries.includes(candidate)) return path.join(showFolder, candidate)
  }
  // Fuzzy fallback: any folder whose lowercase starts with "season" and contains the number
  const re = new RegExp(`^s(?:eason)?\\s*0*${n}$`, 'i')
  const match = entries.find((e) => re.test(e))
  if (match) return path.join(showFolder, match)
  return null
}

// Derive show folder from any episode file in the show (any season).
// Assumes structure: <showFolder>/<seasonFolder>/<file>
async function findShowFolderFromDb(showId: string): Promise<string | null> {
  const anyShowFile = await prisma.episodeFile.findFirst({
    where: { episode: { season: { showId } } },
    select: { path: true },
  })
  if (!anyShowFile) return null
  return path.dirname(path.dirname(anyShowFile.path))
}

// Find show folder by scanning TV scan roots for a folder matching the show title.
async function findShowFolderFromScanRoots(showTitle: string): Promise<string | null> {
  const roots = await prisma.scanRoot.findMany({ where: { type: 'tv' }, select: { path: true } })
  for (const root of roots) {
    let entries: string[]
    try {
      const dirents = await fs.readdir(root.path, { withFileTypes: true })
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name)
    } catch {
      continue
    }
    // Exact match first, then case-insensitive
    const exact = entries.find((e) => e === showTitle)
    if (exact) return path.join(root.path, exact)
    const ci = entries.find((e) => e.toLowerCase() === showTitle.toLowerCase())
    if (ci) return path.join(root.path, ci)
  }
  return null
}

export async function runSeasonScan(showId: string, seasonNumber: number): Promise<SeasonScanResult> {
  if (scanning) throw new Error('A full scan is already running')

  const filesSkipped: { path: string; reason: string }[] = []

  // Step 1: try to get season folder from an existing file in this season
  const anyFile = await prisma.episodeFile.findFirst({
    where: { episode: { season: { showId, seasonNumber } } },
    select: { path: true },
  })

  let seasonFolderPath: string | null = anyFile ? path.dirname(anyFile.path) : null

  // Step 2: if no file in this season, find show folder via any season's file or scan roots
  if (!seasonFolderPath) {
    let showFolder = await findShowFolderFromDb(showId)
    if (!showFolder) {
      const show = await prisma.tvShow.findUnique({ where: { id: showId }, select: { title: true } })
      if (show) showFolder = await findShowFolderFromScanRoots(show.title)
    }
    if (showFolder) {
      seasonFolderPath = await findSeasonFolder(showFolder, seasonNumber)
    }
  }

  if (!seasonFolderPath) {
    // Folder not found on disk — but if this is Season 0 we must still run ghost cleanup.
    // EpisodeFiles may already be gone from a prior scan while the Season row survived.
    // Without the folder we can't walk for new files, but we can still prune the stale row.
    if (seasonNumber === 0) {
      const season0 = await prisma.season.findFirst({
        where: { showId, seasonNumber: 0 },
        select: { id: true, _count: { select: { episodes: { where: { status: 'owned' } } } } },
      })
      if (season0 && season0._count.episodes === 0) {
        await prisma.episode.deleteMany({ where: { seasonId: season0.id } })
        await prisma.season.delete({ where: { id: season0.id } })
        const owned = await prisma.episode.count({ where: { season: { showId }, status: 'owned' } })
        const seasonAgg = await prisma.season.aggregate({ where: { showId }, _sum: { episodeCount: true } })
        const total = seasonAgg._sum.episodeCount ?? 0
        await prisma.tvShow.update({ where: { id: showId }, data: { ownedEpisodes: owned, totalEpisodes: total } })
      }
    }
    return { added: 0, changed: 0, removed: 0, filesFound: 0, filesSkipped, folderFound: false }
  }

  // Derive the scan root by finding which TV scan root contains seasonFolderPath.
  // path.dirname(path.dirname(seasonFolderPath)) is wrong for flat shows (no
  // season subfolder) — it lands at the NAS parent instead of the scan root.
  const tvRoots = await prisma.scanRoot.findMany({ where: { type: 'tv' }, select: { path: true } })
  const matchingTvRoot = tvRoots.find((r) => {
    const rootPrefix = r.path.endsWith('/') ? r.path : r.path + '/'
    return seasonFolderPath.startsWith(rootPrefix) || seasonFolderPath === r.path
  })
  const scanRootPath = matchingTvRoot?.path ?? path.dirname(path.dirname(seasonFolderPath))
  console.log(`[season-scan] show=${showId} season=${seasonNumber} folder=${seasonFolderPath} scanRoot=${scanRootPath}`)

  let added = 0
  let changed = 0
  let filesFound = 0
  const seenPaths = new Set<string>()

  for await (const walkedFile of walkRoot(seasonFolderPath)) {
    seenPaths.add(walkedFile.path)
    filesFound++
    const parsed = parseFilename(walkedFile.path)
    if (parsed.type !== 'tv') {
      filesSkipped.push({ path: walkedFile.path, reason: 'no S/E pattern detected' })
      continue
    }

    const techSpecs = await extractTechSpecs(walkedFile.path)
    try {
      const result = await syncEpisodeFile({ path: walkedFile.path, sizeBytes: walkedFile.sizeBytes, mtimeMs: walkedFile.mtimeMs, parsed, techSpecs }, scanRootPath)
      if (result === 'added') added++
      else if (result === 'changed') changed++
    } catch (err) {
      console.error(`Season scan: failed to sync ${walkedFile.path}:`, err)
      filesSkipped.push({ path: walkedFile.path, reason: err instanceof Error ? err.message : 'sync error' })
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
  }

  // Ghost Season 0 cleanup — runs unconditionally, not gated on orphaned.length.
  // When scanning a specific season (e.g. season 0), EpisodeFiles may already be gone from a
  // prior scan while the Season row survived. We must catch that case here too.
  // Only applies when this is a Season 0 scan — other seasons have TVDB-backed episodeCounts
  // and should not be deleted just because their files are missing.
  if (seasonNumber === 0) {
    const season0 = await prisma.season.findFirst({
      where: { showId, seasonNumber: 0 },
      select: { id: true, _count: { select: { episodes: { where: { status: 'owned' } } } } },
    })
    if (season0 && season0._count.episodes === 0) {
      await prisma.episode.deleteMany({ where: { seasonId: season0.id } })
      await prisma.season.delete({ where: { id: season0.id } })
    }
  }

  // Always recalculate show counts so the header reflects the current state.
  const owned = await prisma.episode.count({ where: { season: { showId }, status: 'owned' } })
  // Recalculate totalEpisodes too — deleting a ghost season must update the header count.
  const seasonAgg = await prisma.season.aggregate({ where: { showId }, _sum: { episodeCount: true } })
  const total = seasonAgg._sum.episodeCount ?? 0
  await prisma.tvShow.update({ where: { id: showId }, data: { ownedEpisodes: owned, totalEpisodes: total } })

  console.log(`[season-scan] done: found=${filesFound} added=${added} changed=${changed} removed=${removed} skipped=${filesSkipped.length}`)
  return { added, changed, removed, filesFound, filesSkipped, folderFound: true, _debug: { seasonFolderPath, scanRootPath } }
}

export async function runShowScan(showId: string): Promise<SeasonScanResult> {
  if (scanning) throw new Error('A full scan is already running')

  const filesSkipped: { path: string; reason: string }[] = []

  // Find show folder
  let showFolder = await findShowFolderFromDb(showId)
  if (!showFolder) {
    const show = await prisma.tvShow.findUnique({ where: { id: showId }, select: { title: true } })
    if (show) showFolder = await findShowFolderFromScanRoots(show.title)
  }

  if (!showFolder) {
    return { added: 0, changed: 0, removed: 0, filesFound: 0, filesSkipped, folderFound: false }
  }

  let added = 0
  let changed = 0
  let filesFound = 0
  const seenPaths = new Set<string>()

  for await (const walkedFile of walkRoot(showFolder)) {
    seenPaths.add(walkedFile.path)
    filesFound++
    const parsed = parseFilename(walkedFile.path)
    if (parsed.type !== 'tv') {
      filesSkipped.push({ path: walkedFile.path, reason: 'no S/E pattern detected' })
      continue
    }

    const techSpecs = await extractTechSpecs(walkedFile.path)
    try {
      // scanRootPath = one level up from the show folder (scanRoot/show)
      const result = await syncEpisodeFile({ path: walkedFile.path, sizeBytes: walkedFile.sizeBytes, mtimeMs: walkedFile.mtimeMs, parsed, techSpecs }, path.dirname(showFolder))
      if (result === 'added') added++
      else if (result === 'changed') changed++
    } catch (err) {
      console.error(`Show scan: failed to sync ${walkedFile.path}:`, err)
      filesSkipped.push({ path: walkedFile.path, reason: err instanceof Error ? err.message : 'sync error' })
    }
  }

  // Prune all episode files for this show that were not seen
  const dbFiles = await prisma.episodeFile.findMany({
    where: { episode: { season: { showId } } },
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
  }

  // Ghost Season 0 cleanup — runs unconditionally, not gated on orphaned.length.
  // Season 0 EpisodeFiles may have been deleted in a prior scan while the Season row survived.
  // Subsequent show-level rescans must still catch and remove those stale rows.
  // Season 0 is always scanner-created (TVDB never auto-creates it), so once all owned
  // episodes are gone the row has no purpose and should be removed.
  const season0 = await prisma.season.findFirst({
    where: { showId, seasonNumber: 0 },
    select: { id: true, _count: { select: { episodes: { where: { status: 'owned' } } } } },
  })
  if (season0 && season0._count.episodes === 0) {
    await prisma.episode.deleteMany({ where: { seasonId: season0.id } })
    await prisma.season.delete({ where: { id: season0.id } })
  }

  // Always recalculate show counts so the header reflects the current state after any
  // file pruning or ghost-season removal above.
  const owned = await prisma.episode.count({ where: { season: { showId }, status: 'owned' } })
  const seasonAgg = await prisma.season.aggregate({ where: { showId }, _sum: { episodeCount: true } })
  const total = seasonAgg._sum.episodeCount ?? 0
  await prisma.tvShow.update({ where: { id: showId }, data: { ownedEpisodes: owned, totalEpisodes: total } })

  return { added, changed, removed, filesFound, filesSkipped, folderFound: true }
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

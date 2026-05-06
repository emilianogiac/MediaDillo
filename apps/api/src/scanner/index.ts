import path from 'node:path'
import { prisma } from '@mediadillo/db'
import type { ScanRootConfig } from '../config.js'
import { walkRoot } from './walker.js'
import { parseFilename } from './filename-parser.js'
import { extractTechSpecs } from './ffprobe.js'
import { detectStaleFiles } from './stale-detector.js'
import { syncMovieFile, syncEpisodeFile, writeScanLog } from './db-sync.js'
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

      for await (const walkedFile of walkRoot(rootConfig.path)) {
        seenVideoPaths.add(walkedFile.path)
        progress.filesFound++
        progress.currentFile = walkedFile.path

        const folderPath = path.join(rootConfig.path, walkedFile.parentFolder)
        visitedFolders.add(folderPath)

        const parsed = parseFilename(walkedFile.path)
        const techSpecs = await extractTechSpecs(walkedFile.path)

        const scannedFile = {
          path: walkedFile.path,
          sizeBytes: walkedFile.sizeBytes,
          mtimeMs: walkedFile.mtimeMs,
          parsed,
          techSpecs,
        }

        try {
          let result: 'added' | 'changed' | 'unchanged'
          if (rootConfig.type === 'tv') {
            // TV scan root: always route to episode sync. If the filename parser
            // couldn't find an S/E pattern the file is unrecognised — skip it
            // rather than letting it pollute the Movie table.
            if (parsed.type !== 'tv') {
              console.warn(`Skipping unrecognised TV file (no S/E pattern): ${walkedFile.path}`)
              continue
            }
            result = await syncEpisodeFile(scannedFile)
          } else {
            // Movies scan root: only sync files the parser classified as movies.
            if (parsed.type !== 'movie') {
              console.warn(`Skipping unexpected TV file in movies root: ${walkedFile.path}`)
              continue
            }
            result = await syncMovieFile(scannedFile, scanRoot.id)
          }

          if (result === 'added') added++
          else if (result === 'changed') changed++
        } catch (err) {
          console.error(`Failed to sync ${walkedFile.path}:`, err)
        }
        progress.filesProcessed++
      }

      // Stale file detection — check each visited folder
      for (const folder of visitedFolders) {
        const stale = await detectStaleFiles(folder, seenVideoPaths)
        allStaleFiles.push(...stale)
      }
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

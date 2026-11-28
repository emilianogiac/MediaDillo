import { stat } from 'node:fs/promises'
import { prisma } from '@mediadillo/db'
import { extractTechSpecs } from './ffprobe.js'

export type ReprobeScope = 'stale' | 'all'

export interface ReprobeOptions {
  dryRun?: boolean
  /**
   * `stale` (default) re-probes only files whose stored size disagrees with disk.
   * `all` re-probes every file, which is what a tiering change needs: #126 fixed
   * the resolution label, but the ~880 affected files have correct sizes, so a
   * size-based pass would skip every one of them.
   */
  scope?: ReprobeScope
}

export interface ReprobeResult {
  checked: number
  stale: number
  reprobed: number
  unreadable: number
  changes: {
    path: string
    oldSize: string
    newSize: string
    oldResolution: string | null
    newResolution: string | null
  }[]
}

/**
 * Re-probe files whose stored byte size disagrees with the file on disk (#124).
 *
 * A file replaced in place keeps its old tech specs when the replacement carries
 * an mtime older than the previous scan, so a rescan cannot repair it. Comparing
 * stored size against disk finds exactly those rows, and is cheap: one `stat` per
 * file, with ffprobe run only on the mismatches.
 *
 * `dryRun` reports what it would do without writing, so the blast radius is
 * visible before anything changes. `scope: 'all'` ignores size and re-probes
 * everything, for when the probe's own interpretation has changed rather than
 * the file.
 */
export async function reprobeStaleFiles(options: ReprobeOptions = {}): Promise<ReprobeResult> {
  const { dryRun = false, scope = 'stale' } = options
  const result: ReprobeResult = { checked: 0, stale: 0, reprobed: 0, unreadable: 0, changes: [] }

  const movieFiles = await prisma.movieFile.findMany({
    select: { id: true, path: true, sizeBytes: true, videoResolution: true },
  })
  const episodeFiles = await prisma.episodeFile.findMany({
    select: { id: true, path: true, sizeBytes: true, videoResolution: true },
  })

  for (const row of [...movieFiles.map((f) => ({ ...f, kind: 'movie' as const })),
                     ...episodeFiles.map((f) => ({ ...f, kind: 'episode' as const }))]) {
    let onDisk: bigint
    try {
      onDisk = BigInt((await stat(row.path)).size)
    } catch {
      result.unreadable++
      continue
    }
    result.checked++
    const sizeDiffers = row.sizeBytes !== onDisk
    if (sizeDiffers) result.stale++
    if (scope === 'stale' && !sizeDiffers) continue

    const specs = await extractTechSpecs(row.path)
    // In `all` scope most files are already correct; only record the ones that move.
    const resolutionDiffers = row.videoResolution !== specs.videoResolution
    if (sizeDiffers || resolutionDiffers) {
      result.changes.push({
        path: row.path,
        oldSize: String(row.sizeBytes ?? 0),
        newSize: String(onDisk),
        oldResolution: row.videoResolution,
        newResolution: specs.videoResolution,
      })
    }
    if (dryRun) continue
    if (scope === 'all' && !sizeDiffers && !resolutionDiffers) continue

    const data = {
      sizeBytes: onDisk,
      durationS: specs.durationS,
      videoCodec: specs.videoCodec,
      videoResolution: specs.videoResolution,
      videoQualityTier: specs.videoQualityTier,
      hdr: specs.hdr,
      audioCodec: specs.audioCodec,
      audioChannels: specs.audioChannels,
      audioQualityTier: specs.audioQualityTier,
      scannedAt: new Date(),
    }
    if (row.kind === 'movie') {
      await prisma.movieFile.update({ where: { id: row.id }, data })
    } else {
      await prisma.episodeFile.update({ where: { id: row.id }, data })
    }
    result.reprobed++
  }

  return result
}

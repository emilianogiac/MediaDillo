import { stat } from 'node:fs/promises'
import { prisma } from '@mediadillo/db'
import { extractTechSpecs } from './ffprobe.js'

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
 * visible before anything changes.
 */
export async function reprobeStaleFiles(dryRun = false): Promise<ReprobeResult> {
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
    if (row.sizeBytes === onDisk) continue
    result.stale++

    const specs = await extractTechSpecs(row.path)
    result.changes.push({
      path: row.path,
      oldSize: String(row.sizeBytes ?? 0),
      newSize: String(onDisk),
      oldResolution: row.videoResolution,
      newResolution: specs.videoResolution,
    })
    if (dryRun) continue

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

import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { prisma } from '@mediadillo/db'
import { canonicalMovieFileName, canonicalMovieFolderName } from './naming.js'
import { deleteToTrash } from './rename.js'
import { sidecarsOfBasename } from './sidecars.js'
import { logActivity } from '../activity/log.js'
import {
  assessMerge,
  verifyMergedOutput,
  type MediaProfile,
  type MergeAssessment,
} from './merge-compat.js'

const PART_PATTERN = /[- _.](cd|part|disk|disc|p)[12]$/i

export interface MultiPartCandidate {
  movieId: string
  title: string
  year: number | null
  part1: { id: string; path: string; sizeBytes: bigint | null }
  part2: { id: string; path: string; sizeBytes: bigint | null }
  /** Probe-based verdict. Only `mergeable` candidates may be merged (issue #77). */
  assessment: MergeAssessment
}

/**
 * Reads a media profile with ffprobe.
 *
 * Duration comes from the last video packet, not the container header: headers lie.
 * Ronin's part2 reports 176.8 min in its header for 56.9 min of actual video, which
 * would wreck any duration-based reasoning built on the header value.
 */
export async function probeMedia(filePath: string): Promise<MediaProfile | null> {
  const json = await runFfprobe([
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height,channels',
    '-of', 'json',
    filePath,
  ])
  if (!json) return null
  let parsed: { streams?: Array<Record<string, unknown>> }
  try {
    parsed = JSON.parse(json) as { streams?: Array<Record<string, unknown>> }
  } catch {
    return null
  }
  const streams = parsed.streams ?? []
  const video = streams.find((st) => st['codec_type'] === 'video')
  const audio = streams.find((st) => st['codec_type'] === 'audio')

  const pts = await runFfprobe([
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'packet=pts_time',
    '-of', 'csv=p=0',
    '-read_intervals', '99999%+#1',
    filePath,
  ])
  const lastPts = (pts ?? '')
    .trim()
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .pop()

  return {
    container: path.extname(filePath).toLowerCase(),
    videoCodec: (video?.['codec_name'] as string | undefined) ?? null,
    width: (video?.['width'] as number | undefined) ?? null,
    height: (video?.['height'] as number | undefined) ?? null,
    audioCodec: (audio?.['codec_name'] as string | undefined) ?? null,
    audioChannels: (audio?.['channels'] as number | undefined) ?? null,
    streamCount: streams.length,
    durationS: lastPts ? Number.parseFloat(lastPts) || 0 : 0,
  }
}

function runFfprobe(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', args)
    const out: string[] = []
    proc.stdout.on('data', (c: Buffer) => out.push(c.toString()))
    proc.on('close', (code) => resolve(code === 0 ? out.join('') : null))
    proc.on('error', () => resolve(null))
  })
}

export async function detectMultiPartMovies(): Promise<MultiPartCandidate[]> {
  const movies = await prisma.movie.findMany({
    where: {
      OR: [{ scanRootId: null }, { scanRoot: { type: 'movies' } }],
    },
    include: { files: { orderBy: { path: 'asc' } } },
  })

  const candidates: MultiPartCandidate[] = []

  for (const movie of movies) {
    if (movie.files.length !== 2) continue
    const [f1, f2] = movie.files as [typeof movie.files[0], typeof movie.files[0]]

    const base1 = path.basename(f1.path, path.extname(f1.path))
    const base2 = path.basename(f2.path, path.extname(f2.path))

    if (!PART_PATTERN.test(base1) || !PART_PATTERN.test(base2)) continue

    // The filename shape alone proves nothing: a 4K and a 1080p copy of the same film
    // were named part1/part2, and samples/trailers were relabelled as parts by an
    // earlier rename. Probe before offering the merge (issue #77).
    const [p1, p2] = await Promise.all([probeMedia(f1.path), probeMedia(f2.path)])
    const assessment: MergeAssessment =
      p1 && p2
        ? assessMerge(p1, p2, movie.runtime ?? null)
        : { verdict: 'unknown', mergeable: false, reasons: ['could not probe both parts'] }

    candidates.push({
      movieId: movie.id,
      title: movie.title,
      year: movie.year,
      part1: { id: f1.id, path: f1.path, sizeBytes: f1.sizeBytes },
      part2: { id: f2.id, path: f2.path, sizeBytes: f2.sizeBytes },
      assessment,
    })
  }

  return candidates
}

export async function mergeMovieParts(
  movieId: string,
): Promise<{ outputPath: string } | { error: string }> {
  const movie = await prisma.movie.findUnique({
    where: { id: movieId },
    include: { files: { orderBy: { path: 'asc' } }, scanRoot: true },
  })

  if (!movie) return { error: 'Movie not found' }
  if (movie.files.length !== 2) return { error: 'Movie does not have exactly 2 files' }
  if (!movie.scanRoot) return { error: 'Movie has no scan root' }

  const [f1, f2] = movie.files as [typeof movie.files[0], typeof movie.files[0]]

  // Re-assess here rather than trusting the caller: this function trashes both
  // originals, so the gate has to sit next to the destructive step (issue #77).
  const [prof1, prof2] = await Promise.all([probeMedia(f1.path), probeMedia(f2.path)])
  if (!prof1 || !prof2) return { error: 'Could not probe both parts' }
  const assessment = assessMerge(prof1, prof2, movie.runtime ?? null)
  if (!assessment.mergeable) {
    return { error: `Not mergeable (${assessment.verdict}): ${assessment.reasons.join('; ')}` }
  }

  // Use the extension of the first file for the output
  const ext = path.extname(f1.path)
  const folderName = canonicalMovieFolderName(movie.title, movie.year)
  const fileName = canonicalMovieFileName(movie.title, movie.year, ext)
  const outputFolder = path.join(movie.scanRoot.path, folderName)
  const outputPath = path.join(outputFolder, fileName)

  const concatFile = `./tmp/concat-${movieId}.txt`

  try {
    await fs.mkdir('./tmp', { recursive: true })
    await fs.mkdir(outputFolder, { recursive: true })
    await fs.writeFile(
      concatFile,
      `file '${f1.path.replace(/'/g, "'\\''") }'\nfile '${f2.path.replace(/'/g, "'\\''")}'\n`,
    )

    await runFfmpegConcat(concatFile, outputPath)

    // ffmpeg routinely exits 0 on a bad -c copy concat, so a zero exit code is not
    // evidence the output is whole. Check it before anything is thrown away.
    const merged = await probeMedia(outputPath)
    if (!merged) {
      await fs.unlink(outputPath).catch(() => {})
      return { error: 'Merged file could not be probed; originals left untouched' }
    }
    const check = verifyMergedOutput(merged, prof1, prof2)
    if (!check.ok) {
      await fs.unlink(outputPath).catch(() => {})
      return { error: `Merge verification failed: ${check.error}; originals left untouched` }
    }

    // Only now is it safe to retire the originals — and "the originals" means each
    // part's sidecars too, not just its video (issue #79). Merging 24 films on the
    // Milan library left 39 .nfo files pointing at videos that no longer existed.
    //
    // Everything named after a part is retired, subtitles included: a subtitle for
    // part1 is timed to the first half only, so renaming it onto the merged file would
    // leave the second half unsubtitled and the first half correct — worse than absent.
    // Offsetting and concatenating subtitles is a separate job.
    const retiredSidecars = await retirePartSidecars([f1.path, f2.path])
    await deleteToTrash(f1.path)
    await deleteToTrash(f2.path)

    // Update DB: remove old files, create one new
    await prisma.movieFile.deleteMany({ where: { id: { in: [f1.id, f2.id] } } })
    await prisma.movieFile.create({
      data: {
        movieId,
        path: outputPath,
        sizeBytes: await getFileSize(outputPath),
      },
    })

    await logActivity({
      action: 'episode_merge',
      movieId,
      filePath: outputPath,
      detail: { mergedParts: [f1.path, f2.path], retiredSidecars },
    }).catch(() => {})

    return { outputPath }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  } finally {
    await fs.unlink(concatFile).catch(() => {})
  }
}

/**
 * Retires every sidecar belonging to the parts being merged, into the same `.trash`
 * as the parts themselves, so one trash entry holds the complete original state.
 *
 * Returns the paths retired, for the activity log.
 *
 * A sidecar that cannot be moved is reported and skipped rather than failing the
 * merge: by the time this runs the output has been produced and verified, so aborting
 * would leave a merged file the database knows nothing about — a worse state than a
 * single stranded .nfo.
 */
export async function retirePartSidecars(partPaths: string[]): Promise<string[]> {
  const retired: string[] = []

  for (const partPath of partPaths) {
    const dir = path.dirname(partPath)
    const base = path.basename(partPath, path.extname(partPath))
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      continue
    }

    for (const entry of sidecarsOfBasename(entries, base)) {
      const full = path.join(dir, entry)
      try {
        await deleteToTrash(full)
        retired.push(full)
      } catch (err) {
        console.warn(`[merge] could not retire sidecar ${full}:`, err)
      }
    }
  }

  return retired
}

function runFfmpegConcat(concatFile: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      // -map 0 is required: without it ffmpeg applies default stream selection and
      // keeps only one video, one audio and one subtitle track, silently discarding
      // everything else while still exiting 0 (issue #80). On the Milan library that
      // cost the Dolby Vision layer and three audio tracks on the 4K titles.
      '-map', '0',
      '-c', 'copy',
      '-y',
      outputPath,
    ])

    const stderr: string[] = []
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString()))

    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-5).join('')}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`))
    })
  })
}

async function getFileSize(filePath: string): Promise<bigint | null> {
  try {
    const stat = await fs.stat(filePath)
    return BigInt(stat.size)
  } catch {
    return null
  }
}

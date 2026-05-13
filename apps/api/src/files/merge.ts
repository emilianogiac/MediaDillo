import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { prisma } from '@mediadillo/db'
import { canonicalMovieFileName, canonicalMovieFolderName } from './naming.js'
import { deleteToTrash } from './rename.js'
import { logActivity } from '../activity/log.js'

const PART_PATTERN = /[- _.](cd|part|disk|disc|p)[12]$/i

export interface MultiPartCandidate {
  movieId: string
  title: string
  year: number | null
  part1: { id: string; path: string; sizeBytes: bigint | null }
  part2: { id: string; path: string; sizeBytes: bigint | null }
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

    candidates.push({
      movieId: movie.id,
      title: movie.title,
      year: movie.year,
      part1: { id: f1.id, path: f1.path, sizeBytes: f1.sizeBytes },
      part2: { id: f2.id, path: f2.path, sizeBytes: f2.sizeBytes },
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

    // Trash originals
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
      detail: { mergedParts: [f1.path, f2.path] },
    }).catch(() => {})

    return { outputPath }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  } finally {
    await fs.unlink(concatFile).catch(() => {})
  }
}

function runFfmpegConcat(concatFile: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
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

import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { prisma } from '@mediadillo/db'

export type ArtworkType = 'poster' | 'backdrop' | 'all'

export interface DownloadResult {
  posterSaved: boolean
  backdropSaved: boolean
  folderPath: string | null
}

// ---------------------------------------------------------------------------
// Movie artwork
// ---------------------------------------------------------------------------

export async function downloadMovieArtwork(
  movieId: string,
  type: ArtworkType = 'all',
): Promise<DownloadResult> {
  const movie = await prisma.movie.findUnique({
    where: { id: movieId },
    include: { files: { take: 1 }, scanRoot: true },
  })
  if (!movie) throw new Error(`Movie ${movieId} not found`)

  const firstFile = movie.files[0]
  if (!firstFile) {
    return { posterSaved: false, backdropSaved: false, folderPath: null }
  }

  const folderPath = path.dirname(firstFile.path)
  let posterSaved = false
  let backdropSaved = false

  if ((type === 'poster' || type === 'all') && movie.posterUrl && !movie.posterDownloaded) {
    posterSaved = await saveImage(movie.posterUrl, path.join(folderPath, 'poster.jpg'))
    if (posterSaved) {
      await prisma.movie.update({ where: { id: movieId }, data: { posterDownloaded: true } })
    }
  }

  if ((type === 'backdrop' || type === 'all') && movie.backdropUrl && !movie.backdropDownloaded) {
    backdropSaved = await saveImage(movie.backdropUrl, path.join(folderPath, 'backdrop.jpg'))
    if (backdropSaved) {
      await prisma.movie.update({ where: { id: movieId }, data: { backdropDownloaded: true } })
    }
  }

  return { posterSaved, backdropSaved, folderPath }
}

// ---------------------------------------------------------------------------
// TV Show artwork
// ---------------------------------------------------------------------------

export async function downloadShowArtwork(
  showId: string,
  type: ArtworkType = 'all',
): Promise<DownloadResult> {
  const show = await prisma.tvShow.findUnique({
    where: { id: showId },
    include: {
      seasons: {
        include: { episodes: { include: { files: { take: 1 } }, take: 1 } },
        take: 1,
      },
    },
  })
  if (!show) throw new Error(`Show ${showId} not found`)

  // Resolve show folder: go up 2 levels from first episode file
  // (file is in Show/Season XX/episode.mkv)
  const firstEpisodeFile = show.seasons[0]?.episodes[0]?.files[0]
  if (!firstEpisodeFile) {
    return { posterSaved: false, backdropSaved: false, folderPath: null }
  }

  const seasonFolder = path.dirname(firstEpisodeFile.path)
  const showFolder = path.dirname(seasonFolder)
  let posterSaved = false
  let backdropSaved = false

  if ((type === 'poster' || type === 'all') && show.posterUrl && !show.posterDownloaded) {
    posterSaved = await saveImage(show.posterUrl, path.join(showFolder, 'poster.jpg'))
    if (posterSaved) {
      await prisma.tvShow.update({ where: { id: showId }, data: { posterDownloaded: true } })
    }
  }

  if ((type === 'backdrop' || type === 'all') && show.backdropUrl && !show.backdropDownloaded) {
    backdropSaved = await saveImage(show.backdropUrl, path.join(showFolder, 'backdrop.jpg'))
    if (backdropSaved) {
      await prisma.tvShow.update({ where: { id: showId }, data: { backdropDownloaded: true } })
    }
  }

  return { posterSaved, backdropSaved, folderPath: showFolder }
}

// ---------------------------------------------------------------------------
// Core download helper
// ---------------------------------------------------------------------------

export async function saveImage(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url)
    if (!res.ok || !res.body) return false

    await fs.mkdir(path.dirname(destPath), { recursive: true })
    const writeStream = createWriteStream(destPath)
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), writeStream)
    return true
  } catch {
    return false
  }
}

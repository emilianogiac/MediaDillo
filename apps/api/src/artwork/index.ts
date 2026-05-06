import { prisma } from '@mediadillo/db'
import { downloadMovieArtwork, downloadShowArtwork } from './downloader.js'

let bulkRunning = false

export function isBulkArtworkRunning(): boolean {
  return bulkRunning
}

export interface BulkArtworkSummary {
  moviesProcessed: number
  showsProcessed: number
  postersDownloaded: number
  backdropsDownloaded: number
  durationMs: number
}

// Download missing artwork for all matched items that have a URL but no local file
export async function runBulkArtworkDownload(): Promise<BulkArtworkSummary> {
  if (bulkRunning) throw new Error('Bulk artwork download already running')
  bulkRunning = true

  const start = Date.now()
  let moviesProcessed = 0
  let showsProcessed = 0
  let postersDownloaded = 0
  let backdropsDownloaded = 0

  try {
    // Movies missing poster or backdrop
    const movies = await prisma.movie.findMany({
      where: {
        tmdbId: { not: null },
        OR: [
          { posterUrl: { not: null }, posterDownloaded: false },
          { backdropUrl: { not: null }, backdropDownloaded: false },
        ],
      },
      select: { id: true },
    })

    for (const { id } of movies) {
      const result = await downloadMovieArtwork(id, 'all')
      moviesProcessed++
      if (result.posterSaved) postersDownloaded++
      if (result.backdropSaved) backdropsDownloaded++
    }

    // Shows missing poster or backdrop
    const shows = await prisma.tvShow.findMany({
      where: {
        tmdbId: { not: null },
        OR: [
          { posterUrl: { not: null }, posterDownloaded: false },
          { backdropUrl: { not: null }, backdropDownloaded: false },
        ],
      },
      select: { id: true },
    })

    for (const { id } of shows) {
      const result = await downloadShowArtwork(id, 'all')
      showsProcessed++
      if (result.posterSaved) postersDownloaded++
      if (result.backdropSaved) backdropsDownloaded++
    }
  } finally {
    bulkRunning = false
  }

  return {
    moviesProcessed,
    showsProcessed,
    postersDownloaded,
    backdropsDownloaded,
    durationMs: Date.now() - start,
  }
}

import { prisma } from '@mediadillo/db'
import { TmdbClient } from './tmdb-client.js'
import { searchMovieCandidates, searchTvCandidates, bestAutoMatch } from './matcher.js'
import { enrichMovie, enrichTvShow } from './enricher.js'

let metadataScanRunning = false

export function isMetadataScanRunning(): boolean {
  return metadataScanRunning
}

export interface MetadataScanSummary {
  moviesMatched: number
  moviesSkipped: number
  showsMatched: number
  showsSkipped: number
  durationMs: number
}

export async function runMetadataScan(tmdbClient: TmdbClient): Promise<MetadataScanSummary> {
  if (metadataScanRunning) throw new Error('Metadata scan already running')
  metadataScanRunning = true

  const start = Date.now()
  let moviesMatched = 0, moviesSkipped = 0
  let showsMatched = 0, showsSkipped = 0

  try {
    // Process unmatched movies
    const unmatchedMovies = await prisma.movie.findMany({ where: { tmdbId: null } })
    for (const movie of unmatchedMovies) {
      let matchedTmdbId: number | null = null

      // Try direct IMDb→TMDB lookup first if we have an IMDb ID
      if (movie.imdbId) {
        try {
          const found = await tmdbClient.findByImdbId(movie.imdbId)
          const r = found.movie_results[0]
          if (r) matchedTmdbId = r.id
        } catch {
          // non-fatal — fall through to title search
        }
        await delay(150)
      }

      // Fall back to title search if IMDb lookup didn't resolve
      if (!matchedTmdbId) {
        const candidates = await searchMovieCandidates(tmdbClient, movie.title, movie.year)
        const best = bestAutoMatch(candidates)
        if (best) matchedTmdbId = best.tmdbId
        await delay(150)
      }

      if (matchedTmdbId) {
        await enrichMovie(tmdbClient, movie.id, matchedTmdbId)
        moviesMatched++
      } else {
        moviesSkipped++
      }
    }

    // Process unmatched TV shows
    const unmatchedShows = await prisma.tvShow.findMany({ where: { tmdbId: null } })
    for (const show of unmatchedShows) {
      const candidates = await searchTvCandidates(tmdbClient, show.title, show.year)
      const best = bestAutoMatch(candidates)
      if (best) {
        await enrichTvShow(tmdbClient, show.id, best.tmdbId)
        showsMatched++
      } else {
        showsSkipped++
      }
      await delay(150)
    }
  } finally {
    metadataScanRunning = false
  }

  return {
    moviesMatched, moviesSkipped,
    showsMatched, showsSkipped,
    durationMs: Date.now() - start,
  }
}

export function makeTmdbClient(apiKey: string): TmdbClient {
  return new TmdbClient(apiKey)
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

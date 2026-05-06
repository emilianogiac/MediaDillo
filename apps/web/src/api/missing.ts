import { apiFetch } from './client.js'
import type { MovieCandidate } from './types.js'

export interface MissingShow {
  id: string
  title: string
  year: number | null
  posterUrl: string | null
  ownedEpisodes: number
  totalEpisodes: number
  showStatus: 'continuing' | 'ended'
  missingCount: number
}

export interface WantedMovie {
  id: string
  title: string
  year: number | null
  posterUrl: string | null
  overview: string | null
  rating: number | null
  genres: string[]
  tmdbId: number | null
  imdbId: string | null
}

export async function fetchMissingShows(): Promise<MissingShow[]> {
  return apiFetch<MissingShow[]>('/missing/shows')
}

export async function fetchWantedMovies(): Promise<WantedMovie[]> {
  return apiFetch<WantedMovie[]>('/missing/movies')
}

export async function addWantedMovie(data: {
  title: string
  year?: number
  tmdbId?: number
  overview?: string
  posterUrl?: string
  rating?: number
  genres?: string[]
}): Promise<WantedMovie> {
  return apiFetch<WantedMovie>('/missing/movies', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function removeWantedMovie(id: string): Promise<void> {
  await apiFetch(`/missing/movies/${id}`, { method: 'DELETE' })
}

export async function searchMoviesForWishlist(q: string, year?: number): Promise<MovieCandidate[]> {
  const params = new URLSearchParams({ q })
  if (year) params.set('year', String(year))
  return apiFetch<MovieCandidate[]>(`/missing/movie-search?${params}`)
}

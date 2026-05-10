const TMDB_BASE = 'https://api.themoviedb.org/3'
const IMAGE_BASE = 'https://image.tmdb.org/t/p'

export const tmdbImageUrl = (path: string | null, size: 'w500' | 'w1280' | 'original') =>
  path ? `${IMAGE_BASE}/${size}${path}` : null

// ---------------------------------------------------------------------------
// Response shapes (only the fields we use)
// ---------------------------------------------------------------------------

export interface TmdbMovieResult {
  id: number
  title: string
  release_date: string        // "YYYY-MM-DD"
  overview: string | null
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  popularity: number
}

export interface TmdbTvResult {
  id: number
  name: string
  first_air_date: string
  overview: string | null
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  popularity: number
}

export interface TmdbMovieDetails extends TmdbMovieResult {
  imdb_id: string | null
  tagline: string | null
  runtime: number | null
  genres: Array<{ id: number; name: string }>
  credits: {
    cast: TmdbCastMember[]
    crew: TmdbCrewMember[]
  }
}

export interface TmdbTvDetails extends TmdbTvResult {
  number_of_seasons: number
  number_of_episodes: number
  status: string              // "Returning Series" | "Ended" | ...
  genres: Array<{ id: number; name: string }>
  credits: {
    cast: TmdbCastMember[]
    crew: TmdbCrewMember[]
  }
}

export interface TmdbCastMember {
  id: number
  name: string
  character: string
  order: number
  profile_path: string | null
}

export interface TmdbCrewMember {
  id: number
  name: string
  job: string
  department: string
  profile_path: string | null
}

export interface TmdbSeason {
  season_number: number
  episode_count: number
  episodes: TmdbEpisode[]
}

export interface TmdbEpisode {
  episode_number: number
  season_number: number
  name: string | null
  overview: string | null
  air_date: string | null     // "YYYY-MM-DD"
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface TmdbFindResult {
  movie_results: TmdbMovieResult[]
  tv_results: TmdbTvResult[]
}

export interface TmdbExternalIds {
  tvdb_id: number | null
  imdb_id: string | null
}

export class TmdbClient {
  private readonly apiKey: string
  private readonly language: string

  constructor(apiKey: string, language = 'en-US') {
    this.apiKey = apiKey
    this.language = language
  }

  async searchMovies(query: string, year?: number | null): Promise<TmdbMovieResult[]> {
    const params = new URLSearchParams({ query, language: this.language, page: '1' })
    if (year) params.set('year', String(year))
    const data = await this.get<{ results: TmdbMovieResult[] }>(`/search/movie?${params}`)
    return data.results
  }

  async searchTv(query: string, year?: number | null): Promise<TmdbTvResult[]> {
    const params = new URLSearchParams({ query, language: this.language, page: '1' })
    if (year) params.set('first_air_date_year', String(year))
    const data = await this.get<{ results: TmdbTvResult[] }>(`/search/tv?${params}`)
    return data.results
  }

  async getMovie(tmdbId: number): Promise<TmdbMovieDetails> {
    return this.get<TmdbMovieDetails>(`/movie/${tmdbId}?append_to_response=credits&language=${this.language}`)
  }

  async getTv(tmdbId: number): Promise<TmdbTvDetails> {
    return this.get<TmdbTvDetails>(`/tv/${tmdbId}?append_to_response=credits&language=${this.language}`)
  }

  async getTvSeason(tmdbId: number, seasonNumber: number): Promise<TmdbSeason> {
    return this.get<TmdbSeason>(`/tv/${tmdbId}/season/${seasonNumber}?language=${this.language}`)
  }

  async findByImdbId(imdbId: string): Promise<TmdbFindResult> {
    return this.get<TmdbFindResult>(`/find/${imdbId}?external_source=imdb_id&language=${this.language}`)
  }

  async getExternalIds(tmdbId: number): Promise<TmdbExternalIds> {
    return this.get<TmdbExternalIds>(`/tv/${tmdbId}/external_ids`)
  }

  private async get<T>(path: string): Promise<T> {
    const sep = path.includes('?') ? '&' : '?'
    const url = `${TMDB_BASE}${path}${sep}api_key=${this.apiKey}`

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    })

    if (!res.ok) {
      throw new Error(`TMDB ${path} → HTTP ${res.status}`)
    }

    return res.json() as Promise<T>
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  titleSimilarity,
  bestAutoMatch,
  searchMovieCandidates,
} from './matcher.js'
import type { TmdbClient } from './tmdb-client.js'

// ---------------------------------------------------------------------------
// titleSimilarity — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe('titleSimilarity', () => {
  it('returns 1.0 for identical titles', () => {
    expect(titleSimilarity('The Godfather', 'The Godfather')).toBe(1.0)
  })

  it('is case-insensitive', () => {
    expect(titleSimilarity('inception', 'Inception')).toBe(1.0)
  })

  it('handles article stripping', () => {
    // "The" stripped from both sides → "godfather" === "godfather"
    expect(titleSimilarity('The Godfather', 'Godfather')).toBeGreaterThan(0.85)
  })

  it('scores high for substring match', () => {
    expect(titleSimilarity('Breaking Bad', 'Breaking Bad: Season 1')).toBeGreaterThan(0.8)
  })

  it('scores lower for different titles', () => {
    expect(titleSimilarity('The Matrix', 'John Wick')).toBeLessThan(0.5)
  })

  it('scores reasonably for slight variations', () => {
    expect(titleSimilarity('Avengers Endgame', 'Avengers: Endgame')).toBeGreaterThan(0.85)
  })
})

// ---------------------------------------------------------------------------
// bestAutoMatch
// ---------------------------------------------------------------------------

describe('bestAutoMatch', () => {
  it('returns best candidate above threshold', () => {
    const candidates = [
      { tmdbId: 1, title: 'A', year: 2020, overview: null, posterUrl: null, score: 0.9 },
      { tmdbId: 2, title: 'B', year: 2020, overview: null, posterUrl: null, score: 0.6 },
    ]
    expect(bestAutoMatch(candidates)?.tmdbId).toBe(1)
  })

  it('returns null when best score is below threshold', () => {
    const candidates = [
      { tmdbId: 1, title: 'A', year: 2020, overview: null, posterUrl: null, score: 0.5 },
    ]
    expect(bestAutoMatch(candidates)).toBeNull()
  })

  it('returns null for empty list', () => {
    expect(bestAutoMatch([])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// searchMovieCandidates — mock TMDB client
// ---------------------------------------------------------------------------

describe('searchMovieCandidates', () => {
  const mockClient = {
    searchMovies: vi.fn(),
  } as unknown as TmdbClient

  beforeEach(() => vi.clearAllMocks())

  it('returns scored candidates sorted by score descending', async () => {
    vi.mocked(mockClient.searchMovies).mockResolvedValue([
      {
        id: 111,
        title: 'The Godfather',
        release_date: '1972-03-24',
        overview: 'Classic film',
        poster_path: '/poster.jpg',
        backdrop_path: null,
        vote_average: 9.2,
        popularity: 100,
      },
      {
        id: 222,
        title: 'Godfather Part II',
        release_date: '1974-12-20',
        overview: 'Sequel',
        poster_path: null,
        backdrop_path: null,
        vote_average: 9.0,
        popularity: 80,
      },
    ])

    const results = await searchMovieCandidates(mockClient, 'The Godfather', 1972)
    expect(results[0]?.tmdbId).toBe(111)
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0)
  })

  it('passes year to TMDB search when provided', async () => {
    vi.mocked(mockClient.searchMovies).mockResolvedValue([])
    await searchMovieCandidates(mockClient, 'Inception', 2010)
    expect(mockClient.searchMovies).toHaveBeenCalledWith('Inception', 2010)
  })

  it('handles empty TMDB results', async () => {
    vi.mocked(mockClient.searchMovies).mockResolvedValue([])
    const results = await searchMovieCandidates(mockClient, 'Unknown Movie', null)
    expect(results).toHaveLength(0)
  })
})

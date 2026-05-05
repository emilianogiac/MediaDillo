import type { TmdbClient, TmdbMovieResult, TmdbTvResult } from './tmdb-client.js'

const AUTO_MATCH_THRESHOLD = 0.75

export interface MovieCandidate {
  tmdbId: number
  title: string
  year: number | null
  overview: string | null
  posterUrl: string | null
  score: number
}

export interface TvCandidate {
  tmdbId: number
  title: string
  year: number | null
  overview: string | null
  posterUrl: string | null
  score: number
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function searchMovieCandidates(
  client: TmdbClient,
  title: string,
  year: number | null,
): Promise<MovieCandidate[]> {
  const results = await client.searchMovies(title, year)
  return results
    .map((r) => ({
      tmdbId: r.id,
      title: r.title,
      year: parseYear(r.release_date),
      overview: r.overview,
      posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
      score: scoreMovie(title, year, r),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
}

export async function searchTvCandidates(
  client: TmdbClient,
  title: string,
  year: number | null,
): Promise<TvCandidate[]> {
  const results = await client.searchTv(title, year)
  return results
    .map((r) => ({
      tmdbId: r.id,
      title: r.name,
      year: parseYear(r.first_air_date),
      overview: r.overview,
      posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
      score: scoreTv(title, year, r),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
}

export function bestAutoMatch<T extends { score: number }>(candidates: T[]): T | null {
  const top = candidates[0]
  if (!top) return null
  return top.score >= AUTO_MATCH_THRESHOLD ? top : null
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreMovie(queryTitle: string, queryYear: number | null, result: TmdbMovieResult): number {
  const resultYear = parseYear(result.release_date)
  return computeScore(queryTitle, queryYear, result.title, resultYear)
}

function scoreTv(queryTitle: string, queryYear: number | null, result: TmdbTvResult): number {
  const resultYear = parseYear(result.first_air_date)
  return computeScore(queryTitle, queryYear, result.name, resultYear)
}

function computeScore(
  queryTitle: string,
  queryYear: number | null,
  resultTitle: string,
  resultYear: number | null,
): number {
  const titleScore = titleSimilarity(queryTitle, resultTitle)

  let yearScore = 0.5 // neutral when no year info
  if (queryYear !== null && resultYear !== null) {
    if (queryYear === resultYear) yearScore = 1.0
    else if (Math.abs(queryYear - resultYear) === 1) yearScore = 0.7 // off-by-one (festival vs release year)
    else yearScore = 0.0
  }

  return titleScore * 0.7 + yearScore * 0.3
}

// Normalized character-based similarity: ratio of matching n-grams
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)

  if (na === nb) return 1.0
  if (na.includes(nb) || nb.includes(na)) return 0.92

  const longer = na.length >= nb.length ? na : nb
  const shorter = na.length < nb.length ? na : nb

  // Word-level overlap
  const wordsA = new Set(na.split(' '))
  const wordsB = new Set(nb.split(' '))
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length
  const union = new Set([...wordsA, ...wordsB]).size
  const jaccardWords = intersection / union

  // Proportion of shorter string's chars in the longer
  const charOverlap = levenshteinSimilarity(shorter, longer)

  return Math.max(jaccardWords, charOverlap)
}

function normalizeTitle(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')    // strip punctuation
    .replace(/\b(the|a|an)\b/g, '') // strip leading articles
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshteinSimilarity(a: string, b: string): number {
  const d = levenshtein(a, b)
  const maxLen = Math.max(a.length, b.length)
  return maxLen === 0 ? 1 : 1 - d / maxLen
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j]! =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!)
    }
  }
  return dp[m]![n]!
}

function parseYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const y = parseInt(dateStr.slice(0, 4), 10)
  return isNaN(y) ? null : y
}

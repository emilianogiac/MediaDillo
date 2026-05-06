import path from 'node:path'
import type { ParsedFilename, ParsedMovie, ParsedEpisode } from './types.js'

// S01E01 / s01e01 / 01x01 / 1x01 — with optional multi-episode (S01E01E02)
const TV_SE_RE = /(?:[Ss](\d{1,2})[Ee](\d{1,2})(?:[Ee](\d{1,2}))*|(\d{1,2})x(\d{1,2}))/

// Trailing quality/noise tags to strip before parsing title
const NOISE_RE =
  /\s*[[(]?(4k|2160p|1080p|720p|480p|bluray|blu-ray|bdrip|webrip|web-dl|hdtv|dvdrip|h\.?264|h\.?265|hevc|x264|x265|avc|xvid|divx|remux|proper|repack|extended|theatrical|directors\.cut|unrated)[)\]]?\s*$/i

// Trailing disc/part suffix on multi-disc movies: "- cd1", "disc 2", "part1", "pt2", etc.
const DISC_SUFFIX_RE = /\s*[-–]?\s*(?:cd|disc|disk|part|pt)\.?\s*\d+\s*$/i

export function parseFilename(filePath: string): ParsedFilename {
  const base = path.basename(filePath, path.extname(filePath))
  const normalized = normalizeDelimiters(base)

  const tvMatch = TV_SE_RE.exec(normalized)
  if (tvMatch) {
    return parseTvFilename(normalized, tvMatch)
  }

  return parseMovieFilename(normalized)
}

function parseTvFilename(normalized: string, match: RegExpExecArray): ParsedEpisode {
  const full = match[0] as string
  // Groups 1-3: SxxExx format; groups 4-5: xxXxx format
  const season = (match[1] ?? match[4]) as string
  const ep1 = (match[2] ?? match[5]) as string
  const ep2 = match[3] as string | undefined
  const seasonNum = parseInt(season, 10)
  const episodes = [parseInt(ep1, 10)]
  if (ep2 !== undefined) episodes.push(parseInt(ep2, 10))

  const beforeSE = normalized.slice(0, match.index).trim().replace(/[-–_\s]+$/, '').trim()
  const afterSE = normalized.slice(match.index + full.length).trim().replace(/^[-–_\s]+/, '').trim()

  // Use extractYearFromTvTitle which handles both "(2005)" and bare "2005" at end of show name
  const showParsed = extractYearFromTvTitle(beforeSE)
  const episodeTitle = afterSE ? stripNoise(afterSE) : null

  return {
    type: 'tv',
    show: showParsed.title,
    year: showParsed.year,
    season: seasonNum,
    episodes,
    episodeTitle: episodeTitle || null,
  }
}

function parseMovieFilename(normalized: string): ParsedMovie {
  // Strip noise tags, then disc suffix, before extracting year
  // e.g. "Title (Year) [1080p] - cd1" → "Title (Year)"
  const noNoise = stripNoise(normalized)
  const noDisc = noNoise.replace(DISC_SUFFIX_RE, '').trim()
  const { title, year } = extractYearFromTitle(noDisc)
  return { type: 'movie', title, year }
}

// Extract trailing (YEAR) from a title string — only matches parenthesised years
// to avoid treating part of the title (e.g. "Blade Runner 2049") as a year.
function extractYearFromTitle(str: string): { title: string; year: number | null } {
  const yearMatch = /\((\d{4})\)\s*$/.exec(str)
  if (yearMatch?.[1]) {
    const year = parseInt(yearMatch[1], 10)
    const title = str.slice(0, yearMatch.index).trim()
    return { title, year }
  }
  return { title: str.trim(), year: null }
}

// Like extractYearFromTitle but also handles bare trailing years used in TV filenames:
// "Show Name 2005 S01E01" → after beforeSE extraction → "Show Name 2005"
// We strip the trailing 4-digit year so all episodes of the same show normalise to the same title.
// Guard: only strip if a non-empty title remains (prevents "1883" → "").
function extractYearFromTvTitle(str: string): { title: string; year: number | null } {
  // Parenthesised year first (higher confidence)
  const parenMatch = /\((\d{4})\)\s*$/.exec(str)
  if (parenMatch?.[1]) {
    return { title: str.slice(0, parenMatch.index).trim(), year: parseInt(parenMatch[1], 10) }
  }
  // Bare trailing year: "Show Name 2005" — only when preceded by a space so "1883" is left alone
  const bareMatch = /\s(\d{4})$/.exec(str)
  if (bareMatch?.[1]) {
    const y = parseInt(bareMatch[1], 10)
    if (y >= 1900 && y <= 2100) {
      const title = str.slice(0, bareMatch.index).trim()
      if (title.length > 0) return { title, year: y }
    }
  }
  return { title: str.trim(), year: null }
}

// Replace dots/underscores used as word separators with spaces,
// but preserve dots in known patterns (e.g. U.S.A, Mr.)
function normalizeDelimiters(str: string): string {
  // Replace underscores
  let result = str.replace(/_/g, ' ')
  // Replace dots that are surrounded by word characters (word separator style)
  result = result.replace(/(?<=\w)\.(?=\w)/g, ' ')
  // Collapse multiple spaces
  result = result.replace(/\s{2,}/g, ' ').trim()
  return result
}

function stripNoise(str: string): string {
  return str.replace(NOISE_RE, '').trim()
}

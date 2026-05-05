import path from 'node:path'
import type { ParsedFilename, ParsedMovie, ParsedEpisode } from './types.js'

// S01E01 or S01E01E02 (multi-episode)
const TV_SE_RE = /[Ss](\d{1,2})[Ee](\d{1,2})(?:[Ee](\d{1,2}))*/

// Trailing quality/noise tags to strip before parsing title
const NOISE_RE =
  /\s*[[(]?(4k|2160p|1080p|720p|480p|bluray|blu-ray|bdrip|webrip|web-dl|hdtv|dvdrip|h\.?264|h\.?265|hevc|x264|x265|avc|xvid|divx|remux|proper|repack|extended|theatrical|directors\.cut|unrated)[)\]]?\s*$/i

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
  const season = match[1] as string
  const ep1 = match[2] as string
  const ep2 = match[3] as string | undefined
  const seasonNum = parseInt(season, 10)
  const episodes = [parseInt(ep1, 10)]
  if (ep2 !== undefined) episodes.push(parseInt(ep2, 10))

  const beforeSE = normalized.slice(0, match.index).trim().replace(/[-–_\s]+$/, '').trim()
  const afterSE = normalized.slice(match.index + full.length).trim().replace(/^[-–_\s]+/, '').trim()

  const showParsed = extractYearFromTitle(beforeSE)
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
  // Strip noise tags before extracting year — e.g. "Title (Year) [1080p]" → "Title (Year)"
  const noNoise = stripNoise(normalized)
  const { title, year } = extractYearFromTitle(noNoise)
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

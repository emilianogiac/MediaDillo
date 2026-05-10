import path from 'node:path'
import type { ParsedFilename, ParsedMovie, ParsedEpisode } from './types.js'

// Matches TV episode codes on the RAW (pre-normalization) filename base:
// S01E01 / s01e01 / S01.E01 / S01-E01 / S01_E01 — with optional multi-episode suffix
// 01x01 / 1x01
// Season 1 Episode 1 / season 01 episode 01 (case-insensitive, variable spacing)
const TV_SE_RE =
  /(?:[Ss](\d{1,2})[._-]?[Ee](\d{1,2})(?:[._-]?[Ee](\d{1,2}))*|(\d{1,2})x(\d{1,2})|[Ss]eason\s+(\d{1,2})\s+[Ee]pisode\s+(\d{1,2}))/

// Trailing quality/noise tags to strip before parsing title
const NOISE_RE =
  /\s*[[(]?(4k|2160p|1080p|720p|480p|bluray|blu-ray|bdrip|webrip|web-dl|hdtv|dvdrip|h\.?264|h\.?265|hevc|x264|x265|avc|xvid|divx|remux|proper|repack|extended|theatrical|directors\.cut|unrated)[)\]]?\s*$/i

// Trailing disc/part suffix on multi-disc movies: "- cd1", "disc 2", "part1", "pt2", etc.
const DISC_SUFFIX_RE = /\s*[-–]?\s*(?:cd|disc|disk|part|pt)\.?\s*\d+\s*$/i

// Edition token: "{edition-Director's Cut}", "{edition-Extended}", etc.
const EDITION_RE = /\s*\{edition-([^}]+)\}\s*/i

export function parseFilename(filePath: string): ParsedFilename {
  const base = path.basename(filePath, path.extname(filePath))
  // Match on the raw base before normalization: dots used as separators in episode
  // codes like "Show.S01.E01" would otherwise become spaces and break the regex.
  const tvMatch = TV_SE_RE.exec(base)
  if (tvMatch) {
    const beforeSE = normalizeDelimiters(base.slice(0, tvMatch.index))
    const afterSE = normalizeDelimiters(base.slice(tvMatch.index + tvMatch[0].length))
    return parseTvFilename(beforeSE, afterSE, tvMatch)
  }

  return parseMovieFilename(normalizeDelimiters(base))
}

function parseTvFilename(beforeSE: string, afterSE: string, match: RegExpExecArray): ParsedEpisode {
  // Groups 1-3: SxxExx / SxxExxExx; groups 4-5: NxN; groups 6-7: Season N Episode N
  const season = (match[1] ?? match[4] ?? match[6]) as string
  const ep1 = (match[2] ?? match[5] ?? match[7]) as string
  const ep2 = match[3] as string | undefined
  const seasonNum = parseInt(season, 10)
  const episodes = [parseInt(ep1, 10)]
  if (ep2 !== undefined) episodes.push(parseInt(ep2, 10))

  // Strip trailing and leading punctuation that may remain after slicing around the episode code
  const cleanBefore = beforeSE.trim().replace(/[-–_\s.]+$/, '').trim()
  const cleanAfter = afterSE.trim().replace(/^[-–_\s.]+/, '').trim()

  const showParsed = extractYearFromTvTitle(cleanBefore)
  const episodeTitle = cleanAfter ? stripNoise(cleanAfter) : null

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
  // Strip noise tags, then disc suffix, then edition token, before extracting year
  // e.g. "Title (Year) {edition-Director's Cut} [1080p] - cd1" → "Title (Year)"
  const noNoise = stripNoise(normalized)
  const noDisc = noNoise.replace(DISC_SUFFIX_RE, '').trim()
  const { edition, remainder } = extractEdition(noDisc)
  const { title, year } = extractYearFromTitle(remainder)
  return { type: 'movie', title, year, edition }
}

// Extract {edition-...} token from a string, returning the label and the remainder.
function extractEdition(str: string): { edition: string | null; remainder: string } {
  const match = EDITION_RE.exec(str)
  if (match?.[1]) {
    const remainder = (str.slice(0, match.index) + str.slice(match.index + match[0].length)).trim()
    return { edition: match[1].trim(), remainder }
  }
  return { edition: null, remainder: str }
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

// Separator between a boundary char and a keyword / between keyword parts.
// Allows: dot, underscore, dash, space — any single optional separator.
// sep  = between keyword tokens (e.g. "3D.SBS", "3D SBS", "3D-SBS")
// bnd  = allowed boundary chars before/after a keyword
const _3D_SEP = '[\\s._-]?'
const _3D_BND_L = '[._\\-\\s\\[( ]'
const _3D_BND_R = '[._\\-\\s\\])]'

// Detect 3D format from a file path by scanning for common keyword patterns.
// Returns the subtype or null if the file is not 3D.
// Handles any word separator (. _ - space) between tokens and at boundaries.
export function detect3DFormat(filePath: string): 'sbs' | 'ou' | 'full_sbs' | 'unknown' | null {
  const name = filePath.toLowerCase()
  const b = (inner: string) => new RegExp(`${_3D_BND_L}(?:${inner})${_3D_BND_R}`).test(name)
  // Full side-by-side — check before generic SBS
  if (b(`full${_3D_SEP}sbs|3d${_3D_SEP}fsbs|3d${_3D_SEP}full${_3D_SEP}sbs`)) return 'full_sbs'
  // Side-by-side
  if (b(`3d${_3D_SEP}sbs|hsbs|h${_3D_SEP}sbs|half${_3D_SEP}sbs|sbs3d`)) return 'sbs'
  // Over-under
  if (b(`3d${_3D_SEP}ou|hou|h${_3D_SEP}ou|half${_3D_SEP}ou|ou3d`)) return 'ou'
  // Generic 3D with no subtype (boundary on both sides, or at end before extension)
  if (new RegExp(`${_3D_BND_L}3d${_3D_BND_R}`).test(name) || /[._\-\s\[]3d$/.test(name)) return 'unknown'
  return null
}

// Parse a movie folder name to extract title and year.
// Best-effort: extracts (YEAR) if present, otherwise uses folder name as-is.
// No noise stripping — folder names are closer to canonical than filenames.
export function parseMovieFolderName(folderName: string): { title: string; year: number | null } {
  return extractYearFromTitle(folderName.trim())
}

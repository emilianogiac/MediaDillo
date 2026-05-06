import path from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['genre', 'actor', 'director', 'uniqueid'].includes(name),
})

export interface NfoMovie {
  tmdbId: number | null
  imdbId: string | null
  title: string | null
  year: number | null
  overview: string | null
  tagline: string | null
  rating: number | null
  runtime: number | null
  genres: string[]
  posterUrl: string | null
  backdropUrl: string | null
  directors: string[]
  cast: Array<{ name: string; role: string | null }>
}

export interface NfoShow {
  tmdbId: number | null
  tvdbId: number | null
  imdbId: string | null
  title: string | null
  year: number | null
  overview: string | null
  rating: number | null
  genres: string[]
  posterUrl: string | null
  backdropUrl: string | null
  status: string | null
}

async function readNfoFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const xml = await readFile(filePath, 'utf8')
    return parser.parse(xml) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractUniqueId(
  uniqueids: Array<{ '#text'?: unknown; '@_type'?: string }> | undefined,
  type: string,
): string | null {
  if (!uniqueids) return null
  const match = uniqueids.find((u) => u['@_type'] === type)
  return match?.['#text'] != null ? String(match['#text']) : null
}

function toNum(val: unknown): number | null {
  const n = Number(val)
  return isNaN(n) || val == null || val === '' ? null : n
}

function toStr(val: unknown): string | null {
  return val != null && val !== '' ? String(val) : null
}

function parseMovieNode(movie: Record<string, unknown>): NfoMovie {
  const uniqueids = movie['uniqueid'] as Array<{ '#text'?: unknown; '@_type'?: string }> | undefined
  const tmdbStr = extractUniqueId(uniqueids, 'tmdb')
  const actors = (movie['actor'] as Array<Record<string, unknown>> | undefined) ?? []
  const directors = (movie['director'] as string[] | undefined) ?? []

  return {
    tmdbId: tmdbStr ? (toNum(tmdbStr) ?? null) : null,
    imdbId: extractUniqueId(uniqueids, 'imdb') ?? toStr(movie['imdbid']),
    title: toStr(movie['title']),
    year: toNum(movie['year']),
    overview: toStr(movie['plot']),
    tagline: toStr(movie['tagline']),
    rating: toNum(movie['rating']),
    runtime: toNum(movie['runtime']),
    genres: ((movie['genre'] as unknown[]) ?? []).map(String).filter(Boolean),
    posterUrl: toStr(movie['thumb']) ?? null,
    backdropUrl: toStr(movie['fanart']) ?? null,
    directors: directors.map(String).filter(Boolean),
    cast: actors.map((a) => ({
      name: toStr(a['name']) ?? '',
      role: toStr(a['role']),
    })).filter((a) => a.name),
  }
}

function parseShowNode(show: Record<string, unknown>): NfoShow {
  const uniqueids = show['uniqueid'] as Array<{ '#text'?: unknown; '@_type'?: string }> | undefined

  return {
    tmdbId: toNum(extractUniqueId(uniqueids, 'tmdb')),
    tvdbId: toNum(extractUniqueId(uniqueids, 'tvdb')),
    imdbId: extractUniqueId(uniqueids, 'imdb') ?? toStr(show['imdbid']),
    title: toStr(show['title']),
    year: toNum(show['year']),
    overview: toStr(show['plot']),
    rating: toNum(show['rating']),
    genres: ((show['genre'] as unknown[]) ?? []).map(String).filter(Boolean),
    posterUrl: toStr(show['thumb']) ?? null,
    backdropUrl: toStr(show['fanart']) ?? null,
    status: toStr(show['status']),
  }
}

// Find the first .nfo file in a folder that matches a given root name or known names
async function findNfoInFolder(folderPath: string, preferredBasenames: string[]): Promise<string | null> {
  let files: string[]
  try {
    files = await readdir(folderPath)
  } catch {
    return null
  }
  // Prefer explicit names first (e.g. "movie.nfo", "tvshow.nfo")
  for (const name of preferredBasenames) {
    if (files.includes(name)) return path.join(folderPath, name)
  }
  // Fall back to any .nfo file in the folder
  const nfo = files.find((f) => f.toLowerCase().endsWith('.nfo'))
  return nfo ? path.join(folderPath, nfo) : null
}

export async function parseMovieNfo(movieFolderPath: string): Promise<NfoMovie | null> {
  const nfoPath = await findNfoInFolder(movieFolderPath, ['movie.nfo'])
  if (!nfoPath) return null
  const parsed = await readNfoFile(nfoPath)
  if (!parsed) return null
  const movie = (parsed['movie'] ?? parsed['Movie']) as Record<string, unknown> | undefined
  if (!movie) return null
  return parseMovieNode(movie)
}

export async function parseShowNfo(showFolderPath: string): Promise<NfoShow | null> {
  const nfoPath = await findNfoInFolder(showFolderPath, ['tvshow.nfo'])
  if (!nfoPath) return null
  const parsed = await readNfoFile(nfoPath)
  if (!parsed) return null
  const show = (parsed['tvshow'] ?? parsed['TvShow']) as Record<string, unknown> | undefined
  if (!show) return null
  return parseShowNode(show)
}

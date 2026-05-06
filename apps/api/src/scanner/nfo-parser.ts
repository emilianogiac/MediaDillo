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

  // Support both <uniqueid type="tmdb"> and direct <tmdbid> tag (older TMM format)
  const tmdbId = toNum(tmdbStr) ?? toNum(movie['tmdbid']) ?? toNum(movie['tmdb_id']) ?? null
  const imdbFromUnique = extractUniqueId(uniqueids, 'imdb')

  return {
    tmdbId,
    imdbId: imdbFromUnique ?? toStr(movie['imdbid']) ?? toStr(movie['id']),
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
    tmdbId: toNum(extractUniqueId(uniqueids, 'tmdb')) ?? toNum(show['tmdbid']) ?? toNum(show['tmdb_id']) ?? null,
    tvdbId: toNum(extractUniqueId(uniqueids, 'tvdb')) ?? toNum(show['tvdbid']) ?? toNum(show['tvdb_id']) ?? null,
    imdbId: extractUniqueId(uniqueids, 'imdb') ?? toStr(show['imdbid']) ?? toStr(show['id']),
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

export interface NfoEpisode {
  title: string | null
  showtitle: string | null
  season: number | null
  episode: number | null
  airDate: string | null
  overview: string | null
  rating: number | null
  tmdbId: number | null
  tvdbId: number | null
}

export async function parseEpisodeNfo(episodeFilePath: string): Promise<NfoEpisode | null> {
  const nfoPath = episodeFilePath.replace(/\.[^.]+$/, '.nfo')
  const parsed = await readNfoFile(nfoPath)
  if (!parsed) return null
  const ep = (parsed['episodedetails'] ?? parsed['EpisodeDetails']) as Record<string, unknown> | undefined
  if (!ep) return null

  const uniqueids = ep['uniqueid'] as Array<{ '#text'?: unknown; '@_type'?: string }> | undefined

  return {
    title: toStr(ep['title']),
    showtitle: toStr(ep['showtitle']),
    season: toNum(ep['season']),
    episode: toNum(ep['episode']),
    airDate: toStr(ep['aired']),
    overview: toStr(ep['plot']),
    rating: toNum(ep['rating']),
    tmdbId: toNum(extractUniqueId(uniqueids, 'tmdb')) ?? toNum(ep['tmdbid']) ?? null,
    tvdbId: toNum(extractUniqueId(uniqueids, 'tvdb')) ?? toNum(ep['tvdbid']) ?? null,
  }
}

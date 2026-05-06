import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@mediadillo/db'

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function tag(name: string, value: string | number | null | undefined): string {
  if (value == null || value === '') return ''
  return `  <${name}>${xmlEscape(String(value))}</${name}>\n`
}

// ---------------------------------------------------------------------------
// Movie NFO
// ---------------------------------------------------------------------------

export async function writeMovieNfo(movieId: string): Promise<string | null> {
  const movie = await prisma.movie.findUnique({
    where: { id: movieId },
    include: {
      files: { take: 1 },
      credits: { include: { person: true }, orderBy: { role: 'asc' } },
    },
  })
  if (!movie) throw new Error(`Movie ${movieId} not found`)

  const firstFile = movie.files[0]
  if (!firstFile) return null

  const folderPath = path.dirname(firstFile.path)
  const nfoPath = path.join(folderPath, 'movie.nfo')

  const cast = movie.credits.filter((c) => c.role === 'cast')
  const directors = movie.credits.filter((c) => c.role === 'director')

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<movie>\n'
  xml += tag('title', movie.title)
  xml += tag('year', movie.year)
  xml += tag('plot', movie.overview)
  xml += tag('tagline', movie.tagline)
  xml += tag('runtime', movie.runtime)
  xml += tag('rating', movie.rating)
  if (movie.tmdbId != null) {
    xml += `  <uniqueid type="tmdb">${movie.tmdbId}</uniqueid>\n`
  }
  if (movie.imdbId) {
    xml += `  <uniqueid type="imdb" default="true">${xmlEscape(movie.imdbId)}</uniqueid>\n`
  }
  for (const genre of movie.genres) {
    xml += tag('genre', genre)
  }
  for (const dir of directors) {
    xml += tag('director', dir.person.name)
  }
  for (const c of cast) {
    xml += '  <actor>\n'
    xml += `    <name>${xmlEscape(c.person.name)}</name>\n`
    if (c.character) xml += `    <role>${xmlEscape(c.character)}</role>\n`
    if (c.person.profileUrl) xml += `    <thumb>${xmlEscape(c.person.profileUrl)}</thumb>\n`
    xml += '  </actor>\n'
  }
  xml += '</movie>\n'

  await writeFile(nfoPath, xml, 'utf8')
  return nfoPath
}

// ---------------------------------------------------------------------------
// TV Show NFO
// ---------------------------------------------------------------------------

export async function writeShowNfo(showId: string): Promise<string | null> {
  const show = await prisma.tvShow.findUnique({
    where: { id: showId },
    include: {
      seasons: {
        include: { episodes: { include: { files: { take: 1 } }, take: 1 } },
        take: 1,
      },
      credits: { include: { person: true }, orderBy: { role: 'asc' } },
    },
  })
  if (!show) throw new Error(`Show ${showId} not found`)

  const firstFile = show.seasons[0]?.episodes[0]?.files[0]
  if (!firstFile) return null

  const seasonFolder = path.dirname(firstFile.path)
  const showFolder = path.dirname(seasonFolder)
  const nfoPath = path.join(showFolder, 'tvshow.nfo')

  const directors = show.credits.filter((c) => c.role === 'director')
  const cast = show.credits.filter((c) => c.role === 'cast')

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tvshow>\n'
  xml += tag('title', show.title)
  xml += tag('year', show.year)
  xml += tag('plot', show.overview)
  xml += tag('rating', show.rating)
  xml += tag('status', show.status)
  if (show.tmdbId != null) {
    xml += `  <uniqueid type="tmdb">${show.tmdbId}</uniqueid>\n`
  }
  for (const genre of show.genres) {
    xml += tag('genre', genre)
  }
  for (const dir of directors) {
    xml += tag('director', dir.person.name)
  }
  for (const c of cast) {
    xml += '  <actor>\n'
    xml += `    <name>${xmlEscape(c.person.name)}</name>\n`
    if (c.character) xml += `    <role>${xmlEscape(c.character)}</role>\n`
    if (c.person.profileUrl) xml += `    <thumb>${xmlEscape(c.person.profileUrl)}</thumb>\n`
    xml += '  </actor>\n'
  }
  xml += '</tvshow>\n'

  await writeFile(nfoPath, xml, 'utf8')
  return nfoPath
}

// ---------------------------------------------------------------------------
// Episode NFO
// ---------------------------------------------------------------------------

export async function writeEpisodeNfo(episodeId: string): Promise<string | null> {
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    include: {
      files: { take: 1 },
      season: true,
    },
  })
  if (!episode) throw new Error(`Episode ${episodeId} not found`)

  const firstFile = episode.files[0]
  if (!firstFile) return null

  const ext = path.extname(firstFile.path)
  const nfoPath = firstFile.path.slice(0, -ext.length) + '.nfo'

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<episodedetails>\n'
  xml += tag('title', episode.title)
  xml += tag('season', episode.season.seasonNumber)
  xml += tag('episode', episode.episodeNumber)
  if (episode.airDate) {
    xml += tag('aired', episode.airDate.toISOString().slice(0, 10))
  }
  xml += '</episodedetails>\n'

  await writeFile(nfoPath, xml, 'utf8')
  return nfoPath
}

// ---------------------------------------------------------------------------
// Bulk NFO
// ---------------------------------------------------------------------------

export async function writeBulkNfo(): Promise<{ movies: number; shows: number; errors: string[] }> {
  const [movies, shows] = await Promise.all([
    prisma.movie.findMany({ where: { status: 'owned' }, select: { id: true } }),
    prisma.tvShow.findMany({ select: { id: true } }),
  ])

  let movieCount = 0
  let showCount = 0
  const errors: string[] = []

  for (const m of movies) {
    try {
      const p = await writeMovieNfo(m.id)
      if (p) movieCount++
    } catch (err) {
      errors.push(`movie:${m.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  for (const s of shows) {
    try {
      const p = await writeShowNfo(s.id)
      if (p) showCount++
    } catch (err) {
      errors.push(`show:${s.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { movies: movieCount, shows: showCount, errors }
}

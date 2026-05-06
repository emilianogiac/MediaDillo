import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeMovieNfo, writeShowNfo, writeEpisodeNfo } from './writer.js'

vi.mock('@mediadillo/db', () => ({
  prisma: {
    movie: { findUnique: vi.fn() },
    tvShow: { findUnique: vi.fn() },
    episode: { findUnique: vi.fn() },
  },
}))

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

import { prisma } from '@mediadillo/db'
import { writeFile } from 'node:fs/promises'

const mockMovie = prisma.movie as unknown as { findUnique: ReturnType<typeof vi.fn> }
const mockShow = prisma.tvShow as unknown as { findUnique: ReturnType<typeof vi.fn> }
const mockEpisode = prisma.episode as unknown as { findUnique: ReturnType<typeof vi.fn> }
const mockWriteFile = writeFile as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('writeMovieNfo', () => {
  it('returns null when movie has no files', async () => {
    mockMovie.findUnique.mockResolvedValue({ id: 'm1', files: [], credits: [] })
    const result = await writeMovieNfo('m1')
    expect(result).toBeNull()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('writes movie.nfo with correct XML', async () => {
    mockMovie.findUnique.mockResolvedValue({
      id: 'm1',
      title: 'Inception',
      year: 2010,
      overview: 'A thief enters dreams.',
      tagline: 'Your mind is the scene.',
      runtime: 148,
      rating: 8.8,
      tmdbId: 27205,
      imdbId: 'tt1375666',
      genres: ['Action', 'Sci-Fi'],
      files: [{ path: '/nas/films/Inception (2010)/Inception (2010).mkv' }],
      credits: [
        {
          role: 'director',
          character: null,
          person: { name: 'Christopher Nolan', profileUrl: null },
        },
        {
          role: 'cast',
          character: 'Dom Cobb',
          person: { name: 'Leonardo DiCaprio', profileUrl: 'https://img.tmdb.org/p.jpg' },
        },
      ],
    })
    mockWriteFile.mockResolvedValue(undefined)

    const result = await writeMovieNfo('m1')
    expect(result).toBe('/nas/films/Inception (2010)/movie.nfo')

    const xml = mockWriteFile.mock.calls[0]?.[1] as string | undefined
    expect(xml).toBeDefined()
    expect(xml).toContain('<title>Inception</title>')
    expect(xml).toContain('<year>2010</year>')
    expect(xml).toContain('<uniqueid type="tmdb">27205</uniqueid>')
    expect(xml).toContain('<uniqueid type="imdb" default="true">tt1375666</uniqueid>')
    expect(xml).toContain('<genre>Action</genre>')
    expect(xml).toContain('<director>Christopher Nolan</director>')
    expect(xml).toContain('<name>Leonardo DiCaprio</name>')
    expect(xml).toContain('<role>Dom Cobb</role>')
  })

  it('escapes XML special characters in title', async () => {
    mockMovie.findUnique.mockResolvedValue({
      id: 'm2',
      title: 'Batman & Robin',
      year: 1997,
      overview: null, tagline: null, runtime: null, rating: null,
      tmdbId: null, imdbId: null, genres: [],
      files: [{ path: '/nas/films/Batman & Robin (1997)/file.mkv' }],
      credits: [],
    })
    mockWriteFile.mockResolvedValue(undefined)

    await writeMovieNfo('m2')
    const xml = mockWriteFile.mock.calls[0]?.[1] as string | undefined
    expect(xml).toBeDefined()
    expect(xml).toContain('<title>Batman &amp; Robin</title>')
  })
})

describe('writeShowNfo', () => {
  it('returns null when show has no episode files', async () => {
    mockShow.findUnique.mockResolvedValue({
      id: 's1', title: 'Test', year: 2020,
      overview: null, genres: [], rating: null, status: 'ended', tmdbId: null,
      seasons: [],
      credits: [],
    })
    const result = await writeShowNfo('s1')
    expect(result).toBeNull()
  })

  it('writes tvshow.nfo with correct path', async () => {
    mockShow.findUnique.mockResolvedValue({
      id: 's1', title: 'Breaking Bad', year: 2008,
      overview: 'Chemistry teacher.', genres: ['Drama'], rating: 9.5,
      status: 'ended', tmdbId: 1396,
      seasons: [{
        episodes: [{
          files: [{ path: '/nas/tv/Breaking Bad/Season 01/ep.mkv' }],
        }],
      }],
      credits: [],
    })
    mockWriteFile.mockResolvedValue(undefined)

    const result = await writeShowNfo('s1')
    expect(result).toBe('/nas/tv/Breaking Bad/tvshow.nfo')
    const xml = mockWriteFile.mock.calls[0]?.[1] as string | undefined
    expect(xml).toBeDefined()
    expect(xml).toContain('<title>Breaking Bad</title>')
    expect(xml).toContain('<uniqueid type="tmdb">1396</uniqueid>')
  })
})

describe('writeEpisodeNfo', () => {
  it('writes episode nfo alongside video file', async () => {
    mockEpisode.findUnique.mockResolvedValue({
      id: 'e1',
      title: 'Pilot',
      episodeNumber: 1,
      airDate: new Date('2008-01-20'),
      season: { seasonNumber: 1 },
      files: [{ path: '/nas/tv/Breaking Bad/Season 01/Breaking Bad - S01E01 - Pilot.mkv' }],
    })
    mockWriteFile.mockResolvedValue(undefined)

    const result = await writeEpisodeNfo('e1')
    expect(result).toBe('/nas/tv/Breaking Bad/Season 01/Breaking Bad - S01E01 - Pilot.nfo')
    const xml = mockWriteFile.mock.calls[0]?.[1] as string | undefined
    expect(xml).toBeDefined()
    expect(xml).toContain('<title>Pilot</title>')
    expect(xml).toContain('<season>1</season>')
    expect(xml).toContain('<episode>1</episode>')
    expect(xml).toContain('<aired>2008-01-20</aired>')
  })
})

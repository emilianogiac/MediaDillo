import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exportMoviesCsv, exportShowsCsv } from './exporter.js'

vi.mock('@mediadillo/db', () => ({
  prisma: {
    movie: { findMany: vi.fn() },
    tvShow: { findMany: vi.fn() },
    scanRoot: { findMany: vi.fn() },
  },
}))

import { prisma } from '@mediadillo/db'

const mockMovie = prisma.movie as unknown as { findMany: ReturnType<typeof vi.fn> }
const mockShow = prisma.tvShow as unknown as { findMany: ReturnType<typeof vi.fn> }

beforeEach(() => vi.clearAllMocks())

describe('exportMoviesCsv', () => {
  it('returns header row when no movies', async () => {
    mockMovie.findMany.mockResolvedValue([])
    const csv = await exportMoviesCsv()
    expect(csv.split('\n')[0]).toContain('id,tmdbId,imdbId,title,year')
  })

  it('includes movie data rows', async () => {
    mockMovie.findMany.mockResolvedValue([
      {
        id: 'm1', tmdbId: 27205, imdbId: 'tt1375666',
        title: 'Inception', year: 2010,
        genres: ['Action', 'Sci-Fi'], runtime: 148, rating: 8.8, status: 'owned',
        scanRoot: { label: 'Films' },
        files: [{ path: '/nas/films/Inception/file.mkv', videoQualityTier: '1080p' }],
      },
    ])
    const csv = await exportMoviesCsv()
    const rows = csv.split('\n')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toContain('Inception')
    expect(rows[1]).toContain('1080p')
    expect(rows[1]).toContain('Action|Sci-Fi')
  })

  it('escapes commas in titles with quotes', async () => {
    mockMovie.findMany.mockResolvedValue([
      {
        id: 'm2', tmdbId: null, imdbId: null,
        title: 'Hello, World', year: 2000,
        genres: [], runtime: null, rating: null, status: 'owned',
        scanRoot: null, files: [],
      },
    ])
    const csv = await exportMoviesCsv()
    expect(csv).toContain('"Hello, World"')
  })
})

describe('exportShowsCsv', () => {
  it('returns header row when no shows', async () => {
    mockShow.findMany.mockResolvedValue([])
    const csv = await exportShowsCsv()
    expect(csv.split('\n')[0]).toContain('id,tmdbId,title')
  })

  it('includes show data', async () => {
    mockShow.findMany.mockResolvedValue([
      {
        id: 's1', tmdbId: 1396, title: 'Breaking Bad', year: 2008,
        status: 'ended', totalEpisodes: 62, ownedEpisodes: 62,
        rating: 9.5, genres: ['Drama', 'Crime'],
      },
    ])
    const csv = await exportShowsCsv()
    expect(csv).toContain('Breaking Bad')
    expect(csv).toContain('Drama|Crime')
  })
})

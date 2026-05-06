import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { libraryHealthRoutes } from './library-health.js'

vi.mock('../config.js', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 7731,
    DATABASE_URL: 'postgresql://test',
    SCAN_ROOTS: [],
    TMDB_API_KEY: undefined,
    TVDB_API_KEY: undefined,
    JELLYFIN_URL: undefined,
    JELLYFIN_API_KEY: undefined,
  },
}))

vi.mock('@mediadillo/db', () => ({
  prisma: {
    movie: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    tvShow: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock('../artwork/downloader.js', () => ({
  downloadMovieArtwork: vi.fn(),
  downloadShowArtwork: vi.fn(),
}))

vi.mock('../metadata/enricher.js', () => ({
  enrichMovie: vi.fn(),
  enrichTvShow: vi.fn(),
}))

vi.mock('../health/job-tracker.js', () => ({
  createJob: vi.fn(() => ({ id: 'job-1', running: true, total: 0, done: 0, errors: [], startedAt: '', finishedAt: null })),
  getJob: vi.fn(),
  tickJob: vi.fn(),
  failJob: vi.fn(),
  finishJob: vi.fn(),
}))

import { prisma } from '@mediadillo/db'
import { getJob } from '../health/job-tracker.js'

const mockMovie = prisma.movie as unknown as { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> }
const mockShow = prisma.tvShow as unknown as { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> }
const mockGetJob = getJob as ReturnType<typeof vi.fn>

async function buildApp() {
  const app = Fastify()
  await app.register(libraryHealthRoutes, { prefix: '/api' })
  return app
}

const makeDbMovie = (overrides = {}) => ({
  id: 'movie-1',
  title: 'Inception',
  year: 2010,
  posterDownloaded: false,
  backdropDownloaded: true,
  tmdbId: 27205,
  overview: 'A dream heist.',
  genres: ['Action', 'Sci-Fi'],
  runtime: 148,
  rating: 8.8,
  _count: { files: 1 },
  ...overrides,
})

const makeDbShow = (overrides = {}) => ({
  id: 'show-1',
  title: 'Breaking Bad',
  year: 2008,
  posterDownloaded: true,
  backdropDownloaded: true,
  tmdbId: 1396,
  overview: 'Chemistry teacher turned drug lord.',
  genres: ['Drama'],
  rating: 9.5,
  ownedEpisodes: 62,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockMovie.findMany.mockResolvedValue([])
  mockMovie.count.mockResolvedValue(0)
  mockShow.findMany.mockResolvedValue([])
  mockShow.count.mockResolvedValue(0)
})

describe('GET /api/library-health/items', () => {
  it('returns empty array when no items', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/library-health/items' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('returns movie items with computed score', async () => {
    mockMovie.findMany.mockResolvedValue([makeDbMovie()])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/library-health/items' })
    expect(res.statusCode).toBe(200)
    const items = res.json()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'movie-1',
      type: 'movie',
      title: 'Inception',
      posterDownloaded: false,
      matched: true,
      metadataComplete: true,
      hasFiles: true,
      score: 4,
    })
  })

  it('returns show items', async () => {
    mockShow.findMany.mockResolvedValue([makeDbShow()])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/library-health/items?type=shows' })
    expect(res.statusCode).toBe(200)
    const items = res.json()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'show', title: 'Breaking Bad', score: 5 })
  })

  it('filters out complete items when incomplete=true', async () => {
    mockMovie.findMany.mockResolvedValue([
      makeDbMovie({ id: 'complete', posterDownloaded: true }),
      makeDbMovie({ id: 'incomplete', posterDownloaded: false }),
    ])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/library-health/items?incomplete=true' })
    const items = res.json()
    expect(items.map((i: { id: string }) => i.id)).not.toContain('complete')
    expect(items.map((i: { id: string }) => i.id)).toContain('incomplete')
  })
})

describe('GET /api/library-health/summary', () => {
  it('returns aggregate counts', async () => {
    mockMovie.count.mockResolvedValue(3)
    mockShow.count.mockResolvedValue(2)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/library-health/summary' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('missingPoster')
    expect(body).toHaveProperty('unmatched')
  })
})

describe('GET /api/library-health/jobs/:id', () => {
  it('returns 404 for unknown job', async () => {
    mockGetJob.mockReturnValue(undefined)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/library-health/jobs/unknown' })
    expect(res.statusCode).toBe(404)
  })

  it('returns job state', async () => {
    mockGetJob.mockReturnValue({ id: 'job-1', running: false, total: 5, done: 5, errors: [] })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/library-health/jobs/job-1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: 'job-1', done: 5 })
  })
})

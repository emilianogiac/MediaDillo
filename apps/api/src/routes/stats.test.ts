import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { statsRoutes } from './stats.js'

vi.mock('@mediadillo/db', () => ({
  prisma: {
    movie: { count: vi.fn() },
    tvShow: { count: vi.fn() },
    episode: { count: vi.fn() },
    movieFile: { aggregate: vi.fn() },
    episodeFile: { aggregate: vi.fn() },
    scanLog: { findFirst: vi.fn() },
  },
}))

import { prisma } from '@mediadillo/db'

const m = prisma.movie as unknown as { count: ReturnType<typeof vi.fn> }
const s = prisma.tvShow as unknown as { count: ReturnType<typeof vi.fn> }
const e = prisma.episode as unknown as { count: ReturnType<typeof vi.fn> }
const mf = prisma.movieFile as unknown as { aggregate: ReturnType<typeof vi.fn> }
const ef = prisma.episodeFile as unknown as { aggregate: ReturnType<typeof vi.fn> }
const sl = prisma.scanLog as unknown as { findFirst: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.clearAllMocks()
  m.count.mockResolvedValue(0)
  s.count.mockResolvedValue(0)
  e.count.mockResolvedValue(0)
  mf.aggregate.mockResolvedValue({ _sum: { sizeBytes: null } })
  ef.aggregate.mockResolvedValue({ _sum: { sizeBytes: null } })
  sl.findFirst.mockResolvedValue(null)
})

describe('GET /api/stats', () => {
  async function buildApp() {
    const app = Fastify()
    await app.register(statsRoutes, { prefix: '/api' })
    return app
  }

  it('returns zeroed stats when library is empty', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/stats' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      movies: 0,
      shows: 0,
      episodesOwned: 0,
      storageBytesStr: '0',
      lastScan: null,
    })
  })

  it('returns real counts', async () => {
    m.count.mockResolvedValue(120)
    s.count.mockResolvedValue(15)
    e.count.mockResolvedValue(450)
    mf.aggregate.mockResolvedValue({ _sum: { sizeBytes: BigInt('500000000000') } })
    ef.aggregate.mockResolvedValue({ _sum: { sizeBytes: BigInt('200000000000') } })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/stats' })
    const body = res.json()
    expect(body.movies).toBe(120)
    expect(body.shows).toBe(15)
    expect(body.storageBytesStr).toBe('700000000000')
  })

  it('includes last scan log', async () => {
    sl.findFirst.mockResolvedValue({
      id: 'log-1',
      startedAt: new Date('2026-05-05T10:00:00Z'),
      finishedAt: new Date('2026-05-05T10:02:00Z'),
      filesAdded: 5,
      filesChanged: 2,
      filesRemoved: 0,
      staleFilesFound: 1,
    })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/stats' })
    const body = res.json()
    expect(body.lastScan).not.toBeNull()
    expect(body.lastScan.filesAdded).toBe(5)
  })
})

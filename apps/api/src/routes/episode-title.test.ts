import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

/**
 * Issue #96.
 *
 * Enrichment used to overwrite `Episode.title` unconditionally, so any
 * human correction was destroyed by the next refresh — and refreshes happen
 * automatically (a rename triggers `triggerLibraryRefresh`).
 *
 * A title corrected by hand is marked `manual` and must outlive enrichment
 * until the user explicitly resets it.
 */
vi.mock('@mediadillo/db', () => ({
  TitleSource: { provider: 'provider', manual: 'manual' },
  prisma: {
    episode: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    tvShow: { update: vi.fn() },
  },
}))

vi.mock('../metadata/tmdb-client.js', () => ({ TmdbClient: class {} }))
vi.mock('../metadata/matcher.js', () => ({ searchMovieCandidates: vi.fn() }))
vi.mock('../api-config.js', () => ({ getApiConfig: vi.fn(async () => ({})) }))

const { prisma } = await import('@mediadillo/db')
const { missingRoutes } = await import('./missing.js')

const EPISODE = {
  id: 'ep1',
  title: 'Un natale tutto speciale',
  titleSource: 'provider',
  season: { showId: 'show1' },
}

async function build() {
  const app = Fastify()
  await app.register(missingRoutes, { prefix: '/api' })
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.episode.findUnique).mockResolvedValue(EPISODE as never)
  vi.mocked(prisma.episode.update).mockImplementation(
    (async (args: { data: Record<string, unknown> }) => ({ ...EPISODE, ...args.data })) as never,
  )
})

describe('PATCH episode title (issue #96)', () => {
  it('marks a corrected title as manual', async () => {
    const app = await build()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/missing/shows/show1/episodes/ep1/title',
      payload: { title: 'Tutto è puffo quel che finisce puffo' },
    })
    expect(res.statusCode).toBe(200)
    expect(prisma.episode.update).toHaveBeenCalledWith({
      where: { id: 'ep1' },
      data: { title: 'Tutto è puffo quel che finisce puffo', titleSource: 'manual' },
    })
  })

  it('trims surrounding whitespace', async () => {
    const app = await build()
    await app.inject({
      method: 'PATCH',
      url: '/api/missing/shows/show1/episodes/ep1/title',
      payload: { title: '  La puffodissea  ' },
    })
    const args = vi.mocked(prisma.episode.update).mock.calls[0]![0] as { data: { title: string } }
    expect(args.data.title).toBe('La puffodissea')
  })

  it('reset hands the title back to the provider without rewriting it', async () => {
    const app = await build()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/missing/shows/show1/episodes/ep1/title',
      payload: { reset: true },
    })
    expect(res.statusCode).toBe(200)
    expect(prisma.episode.update).toHaveBeenCalledWith({
      where: { id: 'ep1' },
      data: { titleSource: 'provider' },
    })
  })

  it('rejects an empty title', async () => {
    const app = await build()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/missing/shows/show1/episodes/ep1/title',
      payload: { title: '   ' },
    })
    expect(res.statusCode).toBe(400)
    expect(prisma.episode.update).not.toHaveBeenCalled()
  })

  it('404s when the episode belongs to a different show', async () => {
    const app = await build()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/missing/shows/OTHER/episodes/ep1/title',
      payload: { title: 'x' },
    })
    expect(res.statusCode).toBe(404)
    expect(prisma.episode.update).not.toHaveBeenCalled()
  })
})

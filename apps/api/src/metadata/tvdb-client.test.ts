import { describe, it, expect, vi, afterEach } from 'vitest'
import { TvdbClient } from './tvdb-client.js'

/**
 * Issue #90.
 *
 * The v4 endpoint `/series/{id}/episodes/{order}/{lang}` has NO server-side season
 * filter. A `season=` query parameter is accepted and silently ignored: asking for
 * season 2 of A-Team returned all 95 episodes across seasons 0-5.
 *
 * The caller then wrote those rows as that season's episodes keyed only on `number`,
 * so the highest season bearing each number won. Season 2 ended up holding season 5's
 * titles at e01-e13, season 4's at e14, and season 3's at e23-e24.
 */
const login = { ok: true, json: async () => ({ data: { token: 'tok' } }) }

const episode = (id: number, seasonNumber: number, number: number, name: string) => ({
  id,
  seasonNumber,
  number,
  name,
  aired: '1983-01-01',
})

/** Mocks /login followed by a single page of episodes. */
function mockFetch(episodes: ReturnType<typeof episode>[]) {
  const fetchMock = vi.fn(async (url: unknown) => {
    if (String(url).includes('/login')) return login as unknown as Response
    return {
      ok: true,
      json: async () => ({ data: { episodes }, links: { next: null } }),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TvdbClient.getEpisodes — season scoping (issue #90)', () => {
  const ALL = [
    episode(1, 1, 1, 'S1E1'),
    episode(2, 1, 2, 'S1E2'),
    episode(3, 2, 1, 'S2E1'),
    episode(4, 2, 2, 'S2E2'),
    episode(5, 5, 1, 'S5E1'),
  ]

  it('returns only the requested season although the API returns them all', async () => {
    mockFetch(ALL)
    const got = await new TvdbClient('key', 'it-IT').getEpisodes(77904, 'official', 2)
    expect(got.map((e) => e.name)).toEqual(['S2E1', 'S2E2'])
  })

  it('does not let another season shadow the requested one', async () => {
    // The exact corruption: S5E1 must not end up as season 2's episode 1.
    mockFetch(ALL)
    const got = await new TvdbClient('key', 'it-IT').getEpisodes(77904, 'official', 2)
    const first = got.find((e) => e.number === 1)
    expect(first?.name).toBe('S2E1')
    expect(got.some((e) => e.seasonNumber !== 2)).toBe(false)
  })

  it('sends no season query parameter, since the API ignores it', async () => {
    const fetchMock = mockFetch(ALL)
    await new TvdbClient('key', 'it-IT').getEpisodes(77904, 'official', 2)
    const urls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => !u.includes('/login'))
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.some((u) => u.includes('season='))).toBe(false)
  })

  it('returns every season when none is requested', async () => {
    mockFetch(ALL)
    const got = await new TvdbClient('key', 'it-IT').getEpisodes(77904, 'official')
    expect(got).toHaveLength(5)
  })

  it('returns an empty list for a season the series does not have', async () => {
    mockFetch(ALL)
    const got = await new TvdbClient('key', 'it-IT').getEpisodes(77904, 'official', 9)
    expect(got).toEqual([])
  })
})

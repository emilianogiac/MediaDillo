import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JellyfinClient, testJellyfinConnection } from './client.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('JellyfinClient', () => {
  const client = new JellyfinClient('http://jellyfin:8096', 'test-api-key')

  it('sends X-Emby-Token header', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ServerName: 'My Jellyfin', Version: '10.8.0' }))
    await client.ping()
    expect(mockFetch).toHaveBeenCalledWith(
      'http://jellyfin:8096/System/Info/Public',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Emby-Token': 'test-api-key' }) }),
    )
  })

  it('triggerLibraryRefresh calls POST /Library/Refresh', async () => {
    mockFetch.mockResolvedValue(jsonResponse(null, 204))
    await client.triggerLibraryRefresh()
    expect(mockFetch).toHaveBeenCalledWith(
      'http://jellyfin:8096/Library/Refresh',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('getWatchedMovieTmdbIds extracts TMDB IDs', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        Items: [
          { ProviderIds: { Tmdb: '27205' } },
          { ProviderIds: { Tmdb: '155' } },
          { ProviderIds: {} },
        ],
      }),
    )
    const ids = await client.getWatchedMovieTmdbIds('user-1')
    expect(ids).toEqual([27205, 155])
  })

  it('getWatchedEpisodePaths extracts paths', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        Items: [
          { Path: '/nas/tv/Breaking Bad/Season 01/ep.mkv' },
          { Path: undefined },
          { Path: '/nas/tv/The Wire/Season 01/ep.mkv' },
        ],
      }),
    )
    const paths = await client.getWatchedEpisodePaths('user-1')
    expect(paths).toHaveLength(2)
    expect(paths[0]).toBe('/nas/tv/Breaking Bad/Season 01/ep.mkv')
  })

  it('getAllMoviesWithIds uses user-scoped endpoint and maps tmdbId', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        Items: [
          { Id: 'jf-abc', ProviderIds: { Tmdb: '27205' } },
          { Id: 'jf-def', ProviderIds: {} },
          { Id: 'jf-ghi', ProviderIds: { Tmdb: '155' } },
        ],
      }),
    )
    const movies = await client.getAllMoviesWithIds('user-1')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/Users/user-1/Items'),
      expect.anything(),
    )
    expect(movies).toEqual([
      { jellyfinId: 'jf-abc', tmdbId: 27205 },
      { jellyfinId: 'jf-def', tmdbId: null },
      { jellyfinId: 'jf-ghi', tmdbId: 155 },
    ])
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401))
    await expect(client.ping()).rejects.toThrow('HTTP 401')
  })
})

describe('testJellyfinConnection', () => {
  it('returns connected status on success', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ ServerName: 'Home Jellyfin', Version: '10.9.1' }),
    )
    const status = await testJellyfinConnection('http://jf:8096', 'key')
    expect(status).toMatchObject({ configured: true, connected: true, serverName: 'Home Jellyfin' })
  })

  it('returns error status on failure', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const status = await testJellyfinConnection('http://jf:8096', 'key')
    expect(status).toMatchObject({ configured: true, connected: false, error: 'ECONNREFUSED' })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchMovieImages, searchTvImages, tmdbImageUrl } from './searcher.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const makeTmdbImage = (filePath: string, voteAverage: number, lang: string | null = 'en') => ({
  file_path: filePath,
  width: 1280,
  height: 720,
  vote_average: voteAverage,
  iso_639_1: lang,
})

const makeResponse = (body: object) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

beforeEach(() => {
  mockFetch.mockReset()
})

describe('searchMovieImages', () => {
  it('returns posters and backdrops sorted by vote_average desc', async () => {
    mockFetch.mockReturnValueOnce(
      makeResponse({
        posters: [
          makeTmdbImage('/low.jpg', 0.5),
          makeTmdbImage('/high.jpg', 8.9),
          makeTmdbImage('/mid.jpg', 5.0),
        ],
        backdrops: [makeTmdbImage('/bd.jpg', 7.0)],
      }),
    )

    const result = await searchMovieImages('key', 12345)
    expect(result.posters[0]!.filePath).toBe('/high.jpg')
    expect(result.posters[1]!.filePath).toBe('/mid.jpg')
    expect(result.posters[2]!.filePath).toBe('/low.jpg')
    expect(result.backdrops).toHaveLength(1)
    expect(result.backdrops[0]!.filePath).toBe('/bd.jpg')
  })

  it('maps image fields to ImageCandidate shape', async () => {
    mockFetch.mockReturnValueOnce(
      makeResponse({ posters: [makeTmdbImage('/poster.jpg', 6.5, null)], backdrops: [] }),
    )

    const { posters } = await searchMovieImages('key', 1)
    expect(posters[0]).toMatchObject({
      filePath: '/poster.jpg',
      url: 'https://image.tmdb.org/t/p/original/poster.jpg',
      width: 1280,
      height: 720,
      language: null,
      voteAverage: 6.5,
    })
  })

  it('caps candidates at 20', async () => {
    const many = Array.from({ length: 30 }, (_, i) => makeTmdbImage(`/${i}.jpg`, i))
    mockFetch.mockReturnValueOnce(makeResponse({ posters: many, backdrops: [] }))

    const { posters } = await searchMovieImages('key', 1)
    expect(posters).toHaveLength(20)
  })

  it('calls the correct TMDB endpoint', async () => {
    mockFetch.mockReturnValueOnce(makeResponse({ posters: [], backdrops: [] }))
    await searchMovieImages('mykey', 999)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/movie/999/images'),
      expect.any(Object),
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api_key=mykey'),
      expect.any(Object),
    )
  })

  it('throws when TMDB returns non-ok status', async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve({ ok: false, status: 401 }))
    await expect(searchMovieImages('key', 1)).rejects.toThrow('HTTP 401')
  })
})

describe('searchTvImages', () => {
  it('calls the /tv/:id/images endpoint', async () => {
    mockFetch.mockReturnValueOnce(makeResponse({ posters: [], backdrops: [] }))
    await searchTvImages('key', 42)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/tv/42/images'),
      expect.any(Object),
    )
  })
})

describe('tmdbImageUrl', () => {
  it('builds original URL by default', () => {
    expect(tmdbImageUrl('/abc.jpg')).toBe('https://image.tmdb.org/t/p/original/abc.jpg')
  })

  it('supports w500 size', () => {
    expect(tmdbImageUrl('/abc.jpg', 'w500')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg')
  })
})

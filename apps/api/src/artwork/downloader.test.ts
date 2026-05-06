import { describe, it, expect, vi, beforeEach } from 'vitest'
import { downloadMovieArtwork, downloadShowArtwork, saveImage } from './downloader.js'

// ---- prisma mock ----
vi.mock('@mediadillo/db', () => ({
  prisma: {
    movie: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tvShow: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

// ---- fs/stream mocks ----
vi.mock('node:fs/promises', () => ({ default: { mkdir: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('node:fs', () => ({
  createWriteStream: vi.fn().mockReturnValue({ on: vi.fn(), write: vi.fn(), end: vi.fn() }),
}))
vi.mock('node:stream/promises', () => ({ pipeline: vi.fn().mockResolvedValue(undefined) }))
vi.mock('node:stream', () => ({
  Readable: { fromWeb: vi.fn().mockReturnValue({}) },
  default: { fromWeb: vi.fn().mockReturnValue({}) },
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { prisma } from '@mediadillo/db'

const movieMock = prisma.movie as unknown as {
  findUnique: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}
const showMock = prisma.tvShow as unknown as {
  findUnique: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

const makeReadableBody = () => ({} as unknown as ReadableStream)

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// saveImage
// ---------------------------------------------------------------------------

describe('saveImage', () => {
  it('returns false when fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, body: null })
    expect(await saveImage('http://x.com/img.jpg', '/dest/poster.jpg')).toBe(false)
  })

  it('returns false when an exception is thrown', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    expect(await saveImage('http://x.com/img.jpg', '/dest/poster.jpg')).toBe(false)
  })

  it('returns true on successful download', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, body: makeReadableBody() })
    expect(await saveImage('http://x.com/img.jpg', '/dest/poster.jpg')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// downloadMovieArtwork
// ---------------------------------------------------------------------------

describe('downloadMovieArtwork', () => {
  const baseMovie = {
    id: 'movie-1',
    posterUrl: 'http://tmdb/poster.jpg',
    backdropUrl: 'http://tmdb/backdrop.jpg',
    posterDownloaded: false,
    backdropDownloaded: false,
    scanRoot: {},
    files: [{ path: '/nas/film/Movie (2020)/Movie (2020).mkv' }],
  }

  it('returns no-op result when movie has no files', async () => {
    movieMock.findUnique.mockResolvedValueOnce({ ...baseMovie, files: [] })
    const result = await downloadMovieArtwork('movie-1', 'all')
    expect(result).toEqual({ posterSaved: false, backdropSaved: false, folderPath: null })
  })

  it('throws when movie not found', async () => {
    movieMock.findUnique.mockResolvedValueOnce(null)
    await expect(downloadMovieArtwork('x', 'all')).rejects.toThrow('Movie x not found')
  })

  it('downloads poster and backdrop and updates DB flags', async () => {
    movieMock.findUnique.mockResolvedValueOnce(baseMovie)
    movieMock.update.mockResolvedValue({})
    mockFetch
      .mockResolvedValueOnce({ ok: true, body: makeReadableBody() }) // poster
      .mockResolvedValueOnce({ ok: true, body: makeReadableBody() }) // backdrop

    const result = await downloadMovieArtwork('movie-1', 'all')
    expect(result.posterSaved).toBe(true)
    expect(result.backdropSaved).toBe(true)
    expect(result.folderPath).toBe('/nas/film/Movie (2020)')
    expect(movieMock.update).toHaveBeenCalledWith({
      where: { id: 'movie-1' },
      data: { posterDownloaded: true },
    })
    expect(movieMock.update).toHaveBeenCalledWith({
      where: { id: 'movie-1' },
      data: { backdropDownloaded: true },
    })
  })

  it('skips poster when posterDownloaded is already true', async () => {
    movieMock.findUnique.mockResolvedValueOnce({ ...baseMovie, posterDownloaded: true })
    movieMock.update.mockResolvedValue({})
    mockFetch.mockResolvedValueOnce({ ok: true, body: makeReadableBody() }) // only backdrop

    const result = await downloadMovieArtwork('movie-1', 'all')
    expect(result.posterSaved).toBe(false)
    expect(result.backdropSaved).toBe(true)
  })

  it('only downloads poster when type=poster', async () => {
    movieMock.findUnique.mockResolvedValueOnce(baseMovie)
    movieMock.update.mockResolvedValue({})
    mockFetch.mockResolvedValueOnce({ ok: true, body: makeReadableBody() })

    const result = await downloadMovieArtwork('movie-1', 'poster')
    expect(result.posterSaved).toBe(true)
    expect(result.backdropSaved).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// downloadShowArtwork
// ---------------------------------------------------------------------------

describe('downloadShowArtwork', () => {
  const baseShow = {
    id: 'show-1',
    posterUrl: 'http://tmdb/show-poster.jpg',
    backdropUrl: 'http://tmdb/show-backdrop.jpg',
    posterDownloaded: false,
    backdropDownloaded: false,
    seasons: [
      {
        episodes: [
          {
            files: [{ path: '/nas/tv/Show (2020)/Season 01/Show - S01E01.mkv' }],
          },
        ],
      },
    ],
  }

  it('returns no-op result when show has no episode files', async () => {
    showMock.findUnique.mockResolvedValueOnce({ ...baseShow, seasons: [] })
    const result = await downloadShowArtwork('show-1', 'all')
    expect(result).toEqual({ posterSaved: false, backdropSaved: false, folderPath: null })
  })

  it('resolves show folder 2 levels up from episode file', async () => {
    showMock.findUnique.mockResolvedValueOnce(baseShow)
    showMock.update.mockResolvedValue({})
    mockFetch
      .mockResolvedValueOnce({ ok: true, body: makeReadableBody() })
      .mockResolvedValueOnce({ ok: true, body: makeReadableBody() })

    const result = await downloadShowArtwork('show-1', 'all')
    expect(result.folderPath).toBe('/nas/tv/Show (2020)')
    expect(result.posterSaved).toBe(true)
    expect(result.backdropSaved).toBe(true)
  })
})

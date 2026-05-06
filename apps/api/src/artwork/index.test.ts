import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runBulkArtworkDownload, isBulkArtworkRunning } from './index.js'

vi.mock('@mediadillo/db', () => ({
  prisma: {
    movie: { findMany: vi.fn() },
    tvShow: { findMany: vi.fn() },
  },
}))

vi.mock('./downloader.js', () => ({
  downloadMovieArtwork: vi.fn(),
  downloadShowArtwork: vi.fn(),
}))

import { prisma } from '@mediadillo/db'
import { downloadMovieArtwork, downloadShowArtwork } from './downloader.js'

const movieFindMany = prisma.movie.findMany as ReturnType<typeof vi.fn>
const showFindMany = prisma.tvShow.findMany as ReturnType<typeof vi.fn>
const dlMovie = downloadMovieArtwork as ReturnType<typeof vi.fn>
const dlShow = downloadShowArtwork as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runBulkArtworkDownload', () => {
  it('queries only items with URL set but not yet downloaded', async () => {
    movieFindMany.mockResolvedValueOnce([])
    showFindMany.mockResolvedValueOnce([])

    await runBulkArtworkDownload()

    expect(movieFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tmdbId: { not: null },
          OR: expect.arrayContaining([
            { posterUrl: { not: null }, posterDownloaded: false },
            { backdropUrl: { not: null }, backdropDownloaded: false },
          ]),
        }),
      }),
    )
  })

  it('accumulates summary counts correctly', async () => {
    movieFindMany.mockResolvedValueOnce([{ id: 'movie-1' }, { id: 'movie-2' }])
    showFindMany.mockResolvedValueOnce([{ id: 'show-1' }])

    dlMovie
      .mockResolvedValueOnce({ posterSaved: true, backdropSaved: false, folderPath: '/a' })
      .mockResolvedValueOnce({ posterSaved: false, backdropSaved: true, folderPath: '/b' })
    dlShow.mockResolvedValueOnce({ posterSaved: true, backdropSaved: true, folderPath: '/c' })

    const summary = await runBulkArtworkDownload()
    expect(summary.moviesProcessed).toBe(2)
    expect(summary.showsProcessed).toBe(1)
    expect(summary.postersDownloaded).toBe(2) // movie-1 poster + show-1 poster
    expect(summary.backdropsDownloaded).toBe(2) // movie-2 backdrop + show-1 backdrop
    expect(summary.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('resets bulkRunning flag even when an error occurs', async () => {
    movieFindMany.mockRejectedValueOnce(new Error('db error'))

    await expect(runBulkArtworkDownload()).rejects.toThrow('db error')
    expect(isBulkArtworkRunning()).toBe(false)
  })

  it('throws if called while already running', async () => {
    // Simulate concurrent call: first call hangs, second should throw
    let resolve!: () => void
    const hung = new Promise<void>((r) => (resolve = r))
    movieFindMany.mockReturnValueOnce(hung)

    const first = runBulkArtworkDownload()
    await expect(runBulkArtworkDownload()).rejects.toThrow('already running')
    resolve()
    // Let first call settle (it'll throw on showFindMany not being mocked, that's fine)
    await first.catch(() => {})
  })
})

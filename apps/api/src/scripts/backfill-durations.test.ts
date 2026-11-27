import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../scanner/ffprobe.js', () => ({ extractTechSpecs: vi.fn() }))
vi.mock('@mediadillo/db', () => ({
  prisma: {
    episodeFile: { findMany: vi.fn(), update: vi.fn() },
    movieFile: { findMany: vi.fn(), update: vi.fn() },
    $disconnect: vi.fn(),
  },
}))

import { backfillDurations } from './backfill-durations.js'
import { prisma } from '@mediadillo/db'

const mockEpisodeFile = prisma.episodeFile as unknown as {
  findMany: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}
const mockMovieFile = prisma.movieFile as unknown as {
  findMany: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEpisodeFile.findMany.mockResolvedValue([])
  mockMovieFile.findMany.mockResolvedValue([])
})

describe('backfillDurations', () => {
  it('writes the probed duration for every NULL row in both tables', async () => {
    mockEpisodeFile.findMany.mockResolvedValue([
      { id: 'ef-1', path: '/tv/a.mkv' },
      { id: 'ef-2', path: '/tv/b.mkv' },
    ])
    mockMovieFile.findMany.mockResolvedValue([{ id: 'mf-1', path: '/movies/c.mkv' }])

    const durations: Record<string, number> = { '/tv/a.mkv': 1320, '/tv/b.mkv': 2640, '/movies/c.mkv': 7200 }
    const result = await backfillDurations({
      concurrency: 1,
      probe: (p) => Promise.resolve(durations[p] ?? null),
    })

    expect(result.episodeFiles).toEqual({ candidates: 2, updated: 2, unreadable: 0 })
    expect(result.movieFiles).toEqual({ candidates: 1, updated: 1, unreadable: 0 })
    expect(mockEpisodeFile.update).toHaveBeenCalledWith({ where: { id: 'ef-1' }, data: { durationS: 1320 } })
    expect(mockEpisodeFile.update).toHaveBeenCalledWith({ where: { id: 'ef-2' }, data: { durationS: 2640 } })
    expect(mockMovieFile.update).toHaveBeenCalledWith({ where: { id: 'mf-1' }, data: { durationS: 7200 } })
  })

  it('only considers rows where durationS is NULL, so a rerun is idempotent', async () => {
    await backfillDurations({ probe: () => Promise.resolve(1) })

    expect(mockEpisodeFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { durationS: null } }),
    )
    expect(mockMovieFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { durationS: null } }),
    )
  })

  it('counts an unreadable file instead of writing a bogus duration', async () => {
    mockEpisodeFile.findMany.mockResolvedValue([{ id: 'ef-1', path: '/tv/gone.mkv' }])

    const result = await backfillDurations({ probe: () => Promise.resolve(null) })

    expect(result.episodeFiles).toEqual({ candidates: 1, updated: 0, unreadable: 1 })
    expect(mockEpisodeFile.update).not.toHaveBeenCalled()
  })

  it('probes but writes nothing under --dry-run', async () => {
    mockEpisodeFile.findMany.mockResolvedValue([{ id: 'ef-1', path: '/tv/a.mkv' }])
    const probe = vi.fn().mockResolvedValue(1320)

    const result = await backfillDurations({ dryRun: true, probe })

    expect(probe).toHaveBeenCalledWith('/tv/a.mkv')
    expect(result.episodeFiles.updated).toBe(1)
    expect(mockEpisodeFile.update).not.toHaveBeenCalled()
  })

  it('passes --limit through as a take on each table', async () => {
    await backfillDurations({ limit: 5, probe: () => Promise.resolve(1) })

    expect(mockEpisodeFile.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }))
    expect(mockMovieFile.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }))
  })

  it('probes each row exactly once when workers run concurrently', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `ef-${i}`, path: `/tv/${i}.mkv` }))
    mockEpisodeFile.findMany.mockResolvedValue(rows)
    const seen: string[] = []

    const result = await backfillDurations({
      concurrency: 8,
      probe: async (p) => {
        await Promise.resolve()
        seen.push(p)
        return 100
      },
    })

    expect(result.episodeFiles.updated).toBe(25)
    expect(new Set(seen).size).toBe(25)
  })

  it('reports progress across both tables as one total', async () => {
    mockEpisodeFile.findMany.mockResolvedValue([{ id: 'ef-1', path: '/tv/a.mkv' }])
    mockMovieFile.findMany.mockResolvedValue([{ id: 'mf-1', path: '/movies/b.mkv' }])
    const onProgress = vi.fn()

    await backfillDurations({ concurrency: 1, probe: () => Promise.resolve(1), onProgress })

    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2)
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2)
  })
})

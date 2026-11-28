import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Issue #124 — a file replaced in place kept its old tech specs. `Mayday (2026)`
 * reported a stored 720p while the file on disk was 1080p and 2.9 GB larger,
 * because the replacement's mtime was OLDER than the previous scan.
 */
vi.mock('node:fs/promises', () => ({ stat: vi.fn() }))
vi.mock('./ffprobe.js', () => ({ extractTechSpecs: vi.fn() }))
vi.mock('@mediadillo/db', () => ({
  prisma: {
    movieFile: { findMany: vi.fn(), update: vi.fn() },
    episodeFile: { findMany: vi.fn(), update: vi.fn() },
  },
}))

const { stat } = await import('node:fs/promises')
const { extractTechSpecs } = await import('./ffprobe.js')
const { prisma } = await import('@mediadillo/db')
const { reprobeStaleFiles } = await import('./reprobe.js')

const SPECS_1080 = {
  durationS: 6625, videoCodec: 'H.265', videoResolution: '1080p', videoQualityTier: '1080p',
  hdr: false, audioCodec: 'EAC3', audioChannels: '5.1', audioQualityTier: 'high',
}

function movieRow(over = {}) {
  return { id: 'mf1', path: '/mnt/nas/film/Mayday (2026)/Mayday (2026).mkv',
           sizeBytes: 2405535179n, videoResolution: '720p', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.movieFile.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.episodeFile.findMany).mockResolvedValue([] as never)
  vi.mocked(extractTechSpecs).mockResolvedValue(SPECS_1080 as never)
})

describe('reprobeStaleFiles', () => {
  it('re-probes a movie file whose size disagrees with disk', async () => {
    vi.mocked(prisma.movieFile.findMany).mockResolvedValue([movieRow()] as never)
    vi.mocked(stat).mockResolvedValue({ size: 5344672117 } as never)

    const r = await reprobeStaleFiles()
    expect(r).toMatchObject({ checked: 1, stale: 1, reprobed: 1, unreadable: 0 })
    expect(prisma.movieFile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mf1' },
        data: expect.objectContaining({ sizeBytes: 5344672117n, videoResolution: '1080p' }),
      }),
    )
  })

  it('leaves a file alone when the stored size already matches disk', async () => {
    vi.mocked(prisma.movieFile.findMany).mockResolvedValue([movieRow()] as never)
    vi.mocked(stat).mockResolvedValue({ size: 2405535179 } as never)

    const r = await reprobeStaleFiles()
    expect(r).toMatchObject({ checked: 1, stale: 0, reprobed: 0 })
    expect(prisma.movieFile.update).not.toHaveBeenCalled()
    expect(extractTechSpecs).not.toHaveBeenCalled()
  })

  it('treats a null stored size as stale', async () => {
    vi.mocked(prisma.movieFile.findMany).mockResolvedValue([movieRow({ sizeBytes: null })] as never)
    vi.mocked(stat).mockResolvedValue({ size: 123 } as never)
    expect(await reprobeStaleFiles()).toMatchObject({ stale: 1, reprobed: 1 })
  })

  it('counts an unreadable file without probing or updating it', async () => {
    vi.mocked(prisma.movieFile.findMany).mockResolvedValue([movieRow()] as never)
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))

    const r = await reprobeStaleFiles()
    expect(r).toMatchObject({ checked: 0, stale: 0, reprobed: 0, unreadable: 1 })
    expect(prisma.movieFile.update).not.toHaveBeenCalled()
  })

  it('reports what would change but writes nothing in dryRun', async () => {
    vi.mocked(prisma.movieFile.findMany).mockResolvedValue([movieRow()] as never)
    vi.mocked(stat).mockResolvedValue({ size: 5344672117 } as never)

    const r = await reprobeStaleFiles(true)
    expect(r).toMatchObject({ stale: 1, reprobed: 0 })
    expect(r.changes[0]).toMatchObject({ oldResolution: '720p', newResolution: '1080p' })
    expect(prisma.movieFile.update).not.toHaveBeenCalled()
  })

  it('handles episode files too, updating the episodeFile table', async () => {
    vi.mocked(prisma.episodeFile.findMany).mockResolvedValue([
      { id: 'ef1', path: '/mnt/nas/serie_tv/S/Season 01/e.mkv', sizeBytes: 100n, videoResolution: '720p' },
    ] as never)
    vi.mocked(stat).mockResolvedValue({ size: 200 } as never)

    await reprobeStaleFiles()
    expect(prisma.episodeFile.update).toHaveBeenCalledOnce()
    expect(prisma.movieFile.update).not.toHaveBeenCalled()
  })

  it('reports zero work on an empty library', async () => {
    expect(await reprobeStaleFiles()).toMatchObject({ checked: 0, stale: 0, reprobed: 0 })
  })
})

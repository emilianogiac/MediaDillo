import { prisma } from '@mediadillo/db'

// ---------------------------------------------------------------------------
// JSON export
// ---------------------------------------------------------------------------

export async function exportJson(): Promise<object> {
  const [movies, shows, scanRoots] = await Promise.all([
    prisma.movie.findMany({
      include: {
        files: true,
        scanRoot: { select: { id: true, label: true, path: true, type: true } },
        credits: { include: { person: true } },
      },
      orderBy: { title: 'asc' },
    }),
    prisma.tvShow.findMany({
      include: {
        seasons: {
          include: {
            episodes: { include: { files: true } },
          },
        },
        credits: { include: { person: true } },
      },
      orderBy: { title: 'asc' },
    }),
    prisma.scanRoot.findMany({ orderBy: { label: 'asc' } }),
  ])

  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    scanRoots,
    movies: movies.map((m) => ({
      ...m,
      files: m.files.map((f) => ({ ...f, sizeBytes: f.sizeBytes?.toString() ?? null })),
    })),
    shows: shows.map((s) => ({
      ...s,
      seasons: s.seasons.map((season) => ({
        ...season,
        episodes: season.episodes.map((ep) => ({
          ...ep,
          files: ep.files.map((f) => ({ ...f, sizeBytes: f.sizeBytes?.toString() ?? null })),
        })),
      })),
    })),
  }
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function csvRow(fields: (string | number | boolean | null | undefined)[]): string {
  return fields
    .map((f) => {
      if (f == null) return ''
      const s = String(f)
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    })
    .join(',')
}

export async function exportMoviesCsv(): Promise<string> {
  const movies = await prisma.movie.findMany({
    include: {
      scanRoot: { select: { label: true } },
      files: { select: { path: true, videoQualityTier: true, videoCodec: true }, take: 1 },
    },
    orderBy: { title: 'asc' },
  })

  const header = csvRow([
    'id', 'tmdbId', 'imdbId', 'title', 'year', 'genres', 'runtime',
    'rating', 'status', 'scanRoot', 'filePath', 'videoQuality',
  ])

  const rows = movies.map((m) =>
    csvRow([
      m.id, m.tmdbId, m.imdbId, m.title, m.year, m.genres.join('|'),
      m.runtime, m.rating, m.status, m.scanRoot?.label ?? '',
      m.files[0]?.path ?? '', m.files[0]?.videoQualityTier ?? '',
    ]),
  )

  return [header, ...rows].join('\n')
}

export async function exportShowsCsv(): Promise<string> {
  const shows = await prisma.tvShow.findMany({
    orderBy: { title: 'asc' },
  })

  const header = csvRow([
    'id', 'tmdbId', 'title', 'year', 'status', 'totalEpisodes', 'ownedEpisodes', 'rating', 'genres',
  ])

  const rows = shows.map((s) =>
    csvRow([
      s.id, s.tmdbId, s.title, s.year, s.status,
      s.totalEpisodes, s.ownedEpisodes, s.rating, s.genres.join('|'),
    ]),
  )

  return [header, ...rows].join('\n')
}

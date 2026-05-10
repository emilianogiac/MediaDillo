import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { downloadMovieArtwork, downloadShowArtwork } from '../artwork/downloader.js'
import { enrichMovie, enrichTvShow } from '../metadata/enricher.js'
import { TmdbClient } from '../metadata/tmdb-client.js'
import { getApiConfig } from '../api-config.js'
import { createJob, getJob, tickJob, failJob, finishJob } from '../health/job-tracker.js'
import { scanMovieFolder, BATCH_SAFE_TO_DELETE } from '../files/cleanup.js'
import { detectStaleFiles } from '../scanner/stale-detector.js'
import { readdir } from 'node:fs/promises'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getAutoCleanupSetting } from './settings.js'

export interface HealthItem {
  id: string
  type: 'movie' | 'show'
  title: string
  year: number | null
  posterDownloaded: boolean
  backdropDownloaded: boolean
  matched: boolean
  metadataComplete: boolean
  hasFiles: boolean
  score: number
}

function movieMetadataComplete(m: {
  overview: string | null
  genres: string[]
  runtime: number | null
  rating: number | null
}): boolean {
  return !!(m.overview && m.genres.length > 0 && m.runtime != null && m.rating != null)
}

function showMetadataComplete(s: {
  overview: string | null
  genres: string[]
  rating: number | null
}): boolean {
  return !!(s.overview && s.genres.length > 0 && s.rating != null)
}

function computeScore(item: Omit<HealthItem, 'score'>): number {
  return (
    (item.posterDownloaded ? 1 : 0) +
    (item.backdropDownloaded ? 1 : 0) +
    (item.matched ? 1 : 0) +
    (item.metadataComplete ? 1 : 0) +
    (item.hasFiles ? 1 : 0)
  )
}

export async function libraryHealthRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/library-health/items
  app.get<{
    Querystring: {
      type?: 'movies' | 'shows' | 'all'
      missingPoster?: string
      missingBackdrop?: string
      unmatched?: string
      noFiles?: string
      incomplete?: string
    }
  }>('/library-health/items', async (req, reply) => {
    const {
      type = 'all',
      missingPoster,
      missingBackdrop,
      unmatched,
      noFiles,
      incomplete,
    } = req.query

    const items: HealthItem[] = []

    if (type === 'all' || type === 'movies') {
      const movies = await prisma.movie.findMany({
        where: {
          status: 'owned',
          ...(missingPoster === 'true' ? { posterDownloaded: false } : {}),
          ...(missingBackdrop === 'true' ? { backdropDownloaded: false } : {}),
          ...(unmatched === 'true' ? { tmdbId: null } : {}),
          ...(noFiles === 'true' ? { files: { none: {} } } : {}),
        },
        select: {
          id: true,
          title: true,
          year: true,
          posterDownloaded: true,
          backdropDownloaded: true,
          tmdbId: true,
          overview: true,
          genres: true,
          runtime: true,
          rating: true,
          _count: { select: { files: true } },
        },
        orderBy: { title: 'asc' },
      })

      for (const m of movies) {
        const partial: Omit<HealthItem, 'score'> = {
          id: m.id,
          type: 'movie',
          title: m.title,
          year: m.year,
          posterDownloaded: m.posterDownloaded,
          backdropDownloaded: m.backdropDownloaded,
          matched: m.tmdbId != null,
          metadataComplete: movieMetadataComplete(m),
          hasFiles: m._count.files > 0,
        }
        const score = computeScore(partial)
        if (incomplete === 'true' && score === 5) continue
        items.push({ ...partial, score })
      }
    }

    if (type === 'all' || type === 'shows') {
      const shows = await prisma.tvShow.findMany({
        where: {
          ...(missingPoster === 'true' ? { posterDownloaded: false } : {}),
          ...(missingBackdrop === 'true' ? { backdropDownloaded: false } : {}),
          ...(unmatched === 'true' ? { tmdbId: null } : {}),
          ...(noFiles === 'true' ? { ownedEpisodes: 0 } : {}),
        },
        select: {
          id: true,
          title: true,
          year: true,
          posterDownloaded: true,
          backdropDownloaded: true,
          tmdbId: true,
          overview: true,
          genres: true,
          rating: true,
          ownedEpisodes: true,
        },
        orderBy: { title: 'asc' },
      })

      for (const s of shows) {
        const partial: Omit<HealthItem, 'score'> = {
          id: s.id,
          type: 'show',
          title: s.title,
          year: s.year,
          posterDownloaded: s.posterDownloaded,
          backdropDownloaded: s.backdropDownloaded,
          matched: s.tmdbId != null,
          metadataComplete: showMetadataComplete(s),
          hasFiles: s.ownedEpisodes > 0,
        }
        const score = computeScore(partial)
        if (incomplete === 'true' && score === 5) continue
        items.push({ ...partial, score })
      }
    }

    items.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title))
    return reply.send(items)
  })

  // GET /api/library-health/summary — counts per issue type
  app.get('/library-health/summary', async (_req, reply) => {
    const [
      moviesMissingPoster,
      moviesMissingBackdrop,
      moviesUnmatched,
      moviesNoFiles,
      showsMissingPoster,
      showsMissingBackdrop,
      showsUnmatched,
    ] = await Promise.all([
      prisma.movie.count({ where: { status: 'owned', posterDownloaded: false } }),
      prisma.movie.count({ where: { status: 'owned', backdropDownloaded: false } }),
      prisma.movie.count({ where: { status: 'owned', tmdbId: null } }),
      prisma.movie.count({ where: { status: 'owned', files: { none: {} } } }),
      prisma.tvShow.count({ where: { posterDownloaded: false } }),
      prisma.tvShow.count({ where: { backdropDownloaded: false } }),
      prisma.tvShow.count({ where: { tmdbId: null } }),
    ])

    return reply.send({
      missingPoster: moviesMissingPoster + showsMissingPoster,
      missingBackdrop: moviesMissingBackdrop + showsMissingBackdrop,
      unmatched: moviesUnmatched + showsUnmatched,
      noFiles: moviesNoFiles,
    })
  })

  // POST /api/library-health/artwork/bulk-download — background artwork download
  app.post<{
    Body: { type?: 'movies' | 'shows' | 'all' }
  }>('/library-health/artwork/bulk-download', async (req, reply) => {
    const mediaType = req.body.type ?? 'all'

    const [movies, shows] = await Promise.all([
      mediaType !== 'shows'
        ? prisma.movie.findMany({
            where: {
              status: 'owned',
              tmdbId: { not: null },
              OR: [{ posterDownloaded: false }, { backdropDownloaded: false }],
            },
            select: { id: true },
          })
        : [],
      mediaType !== 'movies'
        ? prisma.tvShow.findMany({
            where: {
              tmdbId: { not: null },
              OR: [{ posterDownloaded: false }, { backdropDownloaded: false }],
            },
            select: { id: true },
          })
        : [],
    ])

    const total = movies.length + shows.length
    if (total === 0) {
      return reply.send({ jobId: null, message: 'Nothing to download' })
    }

    const job = createJob(total)

    const runBulk = async () => {
      for (const m of movies) {
        try {
          await downloadMovieArtwork(m.id, 'all')
        } catch (err) {
          failJob(job.id, `movie:${m.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
        tickJob(job.id)
      }
      for (const s of shows) {
        try {
          await downloadShowArtwork(s.id, 'all')
        } catch (err) {
          failJob(job.id, `show:${s.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
        tickJob(job.id)
      }
      finishJob(job.id)
    }

    runBulk().catch((err: unknown) => {
      app.log.error(err, 'Bulk artwork download failed')
      finishJob(job.id)
    })

    return reply.code(202).send({ jobId: job.id, total })
  })

  // GET /api/library-health/jobs/:id — poll job status
  app.get<{ Params: { id: string } }>('/library-health/jobs/:id', async (req, reply) => {
    const job = getJob(req.params.id)
    if (!job) return reply.code(404).send({ error: 'Job not found' })
    return reply.send(job)
  })

  // POST /api/library-health/metadata/refresh — re-enrich selected items
  app.post<{
    Body: { movieIds?: string[]; showIds?: string[] }
  }>('/library-health/metadata/refresh', async (req, reply) => {
    const cfg = await getApiConfig()
    if (!cfg.tmdbApiKey) {
      return reply.code(422).send({ error: 'TMDB API key is not configured' })
    }

    const { movieIds = [], showIds = [] } = req.body
    const total = movieIds.length + showIds.length

    if (total === 0) {
      return reply.code(400).send({ error: 'No items provided' })
    }

    const [movies, shows] = await Promise.all([
      movieIds.length > 0
        ? prisma.movie.findMany({
            where: { id: { in: movieIds }, tmdbId: { not: null } },
            select: { id: true, title: true, tmdbId: true },
          })
        : [],
      showIds.length > 0
        ? prisma.tvShow.findMany({
            where: { id: { in: showIds }, tmdbId: { not: null } },
            select: { id: true, title: true, tmdbId: true },
          })
        : [],
    ])

    const job = createJob(movies.length + shows.length)
    const client = new TmdbClient(cfg.tmdbApiKey, cfg.metadataLanguage)
    const autoCleanup = await getAutoCleanupSetting()

    const run = async () => {
      for (const m of movies) {
        if (m.tmdbId == null) continue
        try {
          await enrichMovie(client, m.id, m.tmdbId)
          await downloadMovieArtwork(m.id, 'all', true)
          if (autoCleanup) {
            const scan = await scanMovieFolder(m.id)
            if (scan) {
              const toDelete = scan.files.filter((f) => BATCH_SAFE_TO_DELETE.has(f.category))
              await Promise.all(toDelete.map((f) => fs.unlink(f.path).catch(() => {})))
            }
          }
        } catch (err) {
          failJob(job.id, `"${m.title}": ${err instanceof Error ? err.message : String(err)}`)
        }
        tickJob(job.id)
      }
      for (const s of shows) {
        if (s.tmdbId == null) continue
        try {
          await enrichTvShow(client, s.id, s.tmdbId)
          await downloadShowArtwork(s.id, 'all', true)
        } catch (err) {
          failJob(job.id, `"${s.title}": ${err instanceof Error ? err.message : String(err)}`)
        }
        tickJob(job.id)
      }
      finishJob(job.id)
    }

    run().catch((err: unknown) => {
      app.log.error(err, 'Metadata refresh failed')
      finishJob(job.id)
    })

    return reply.code(202).send({ jobId: job.id, total: job.total })
  })

  // POST /library-health/cleanup — batch delete safe-to-delete files across movie and/or show folders
  app.post<{ Body: { movieIds?: string[]; showIds?: string[] } }>('/library-health/cleanup', async (req, reply) => {
    const { movieIds = [], showIds = [] } = req.body
    if (movieIds.length === 0 && showIds.length === 0) {
      return reply.code(400).send({ error: 'No movies or shows provided' })
    }

    const [movies, shows] = await Promise.all([
      prisma.movie.findMany({ where: { id: { in: movieIds } }, select: { id: true, title: true } }),
      prisma.tvShow.findMany({
        where: { id: { in: showIds } },
        select: {
          id: true,
          title: true,
          seasons: { take: 1, select: { episodes: { take: 1, select: { files: { take: 1, select: { path: true } } } } } },
        },
      }),
    ])

    const job = createJob(movies.length + shows.length)

    // Find and delete stale-extension files in a folder tree (non-destructively skips videos/art/NFOs)
    async function cleanShowFolder(dir: string, knownPaths: Set<string>) {
      let entries: string[]
      try { entries = await readdir(dir) } catch { return }
      const stale = await detectStaleFiles(dir, knownPaths)
      for (const f of stale) {
        // Only auto-delete explicitly stale extensions — never "unrecognized" or "video not in library"
        if (f.reason.startsWith('stale file type')) {
          try { await fs.unlink(f.path) } catch { /* skip */ }
        }
      }
      for (const entry of entries) {
        if (entry.startsWith('.')) continue
        if (!path.extname(entry)) await cleanShowFolder(path.join(dir, entry), knownPaths)
      }
    }

    const run = async () => {
      for (const movie of movies) {
        try {
          const scanned = await scanMovieFolder(movie.id)
          if (scanned) {
            const toDelete = scanned.files.filter((f) => BATCH_SAFE_TO_DELETE.has(f.category))
            for (const f of toDelete) {
              try { await fs.unlink(f.path) } catch { /* skip */ }
            }
          }
        } catch (err) {
          failJob(job.id, `"${movie.title}": ${err instanceof Error ? err.message : String(err)}`)
        }
        tickJob(job.id)
      }
      for (const show of shows) {
        try {
          const firstPath = show.seasons[0]?.episodes[0]?.files[0]?.path
          if (firstPath) {
            const showFolder = path.dirname(path.dirname(firstPath))
            const knownPaths = new Set(
              (await prisma.episodeFile.findMany({
                where: { episode: { season: { showId: show.id } } },
                select: { path: true },
              })).map((f) => f.path),
            )
            await cleanShowFolder(showFolder, knownPaths)
          }
        } catch (err) {
          failJob(job.id, `"${show.title}": ${err instanceof Error ? err.message : String(err)}`)
        }
        tickJob(job.id)
      }
      finishJob(job.id)
    }

    run().catch((err: unknown) => {
      app.log.error(err, 'Batch cleanup failed')
      finishJob(job.id)
    })

    return reply.code(202).send({ jobId: job.id, total: job.total })
  })
}

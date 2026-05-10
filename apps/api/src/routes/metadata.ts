import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { TmdbClient } from '../metadata/tmdb-client.js'
import { TvdbClient } from '../metadata/tvdb-client.js'
import { searchMovieCandidates, searchTvCandidates, type MovieCandidate } from '../metadata/matcher.js'
import { enrichMovie, enrichTvShow } from '../metadata/enricher.js'
import { runMetadataScan, isMetadataScanRunning } from '../metadata/index.js'
import { getApiConfig } from '../api-config.js'
import { writeMovieNfo } from '../nfo/writer.js'
import { downloadMovieArtwork, downloadShowArtwork } from '../artwork/downloader.js'
import { getAutoCleanupSetting } from './settings.js'
import { scanMovieFolder, BATCH_SAFE_TO_DELETE } from '../files/cleanup.js'
import fs from 'node:fs/promises'

async function getTmdbClient(): Promise<TmdbClient> {
  const cfg = await getApiConfig()
  if (!cfg.tmdbApiKey) throw new Error('TMDB API key is not configured')
  return new TmdbClient(cfg.tmdbApiKey, cfg.metadataLanguage)
}

// Module-level cache — one TvdbClient instance per process so the JWT token is reused
let _tvdbClientCache: { apiKey: string; client: TvdbClient } | null = null

async function getTvdbClientOrNull(): Promise<TvdbClient | null> {
  const cfg = await getApiConfig()
  if (!cfg.tvdbApiKey) return null
  if (_tvdbClientCache?.apiKey === cfg.tvdbApiKey) return _tvdbClientCache.client
  const client = new TvdbClient(cfg.tvdbApiKey)
  _tvdbClientCache = { apiKey: cfg.tvdbApiKey, client }
  return client
}

export async function metadataRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/metadata/scan — batch auto-match all unmatched items
  app.post('/metadata/scan', async (_req, reply) => {
    const cfg = await getApiConfig()
    if (!cfg.tmdbApiKey) {
      return reply.code(422).send({ error: 'TMDB API key is not configured' })
    }
    if (isMetadataScanRunning()) {
      return reply.code(409).send({ error: 'Metadata scan already in progress' })
    }

    const client = await getTmdbClient()
    const tvdbClient = await getTvdbClientOrNull()
    runMetadataScan(client, tvdbClient).catch((err: unknown) => {
      app.log.error(err, 'Metadata scan failed')
    })

    return reply.code(202).send({ message: 'Metadata scan started' })
  })

  // GET /api/metadata/status
  app.get('/metadata/status', async (_req, reply) => {
    return reply.send({ scanning: isMetadataScanRunning() })
  })

  // GET /api/metadata/unmatched — items without a TMDB ID
  app.get('/metadata/unmatched', async (_req, reply) => {
    const [movies, shows] = await Promise.all([
      prisma.movie.findMany({
        where: { tmdbId: null },
        select: { id: true, title: true, year: true, scanRootId: true },
        orderBy: { title: 'asc' },
      }),
      prisma.tvShow.findMany({
        where: { tmdbId: null },
        select: { id: true, title: true, year: true },
        orderBy: { title: 'asc' },
      }),
    ])
    return reply.send({ movies, shows, total: movies.length + shows.length })
  })

  // GET /api/metadata/movies/:id/candidates?q= — search TMDB for manual selection
  // Optional ?q= overrides the stored title for the TMDB search.
  // If movie has imdbId and no ?q= is given, prepend the direct IMDb→TMDB lookup result.
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>('/metadata/movies/:id/candidates', async (req, reply) => {
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })

    const client = await getTmdbClient()
    const customQuery = req.query.q?.trim()

    let imdbCandidate: MovieCandidate | null = null
    if (!customQuery && movie.imdbId) {
      try {
        const found = await client.findByImdbId(movie.imdbId)
        const r = found.movie_results[0]
        if (r) {
          imdbCandidate = {
            tmdbId: r.id,
            title: r.title,
            year: r.release_date ? parseInt(r.release_date.slice(0, 4), 10) : null,
            overview: r.overview,
            posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
            score: 1.0,
          }
        }
      } catch {
        // IMDb lookup failure is non-fatal; fall through to title search
      }
    }

    const searchTitle = customQuery ?? movie.title
    const searchYear = customQuery ? null : movie.year
    const searchResults = await searchMovieCandidates(client, searchTitle, searchYear)
    // Deduplicate: remove from search results if same tmdbId as IMDb result
    const deduped = imdbCandidate
      ? searchResults.filter((c) => c.tmdbId !== imdbCandidate!.tmdbId)
      : searchResults
    const candidates = imdbCandidate ? [imdbCandidate, ...deduped] : deduped

    return reply.send({ movie: { id: movie.id, title: movie.title, year: movie.year }, candidates })
  })

  // GET /api/metadata/shows/:id/candidates
  app.get<{ Params: { id: string } }>('/metadata/shows/:id/candidates', async (req, reply) => {
    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    const client = await getTmdbClient()
    const candidates = await searchTvCandidates(client, show.title, show.year)
    return reply.send({ show: { id: show.id, title: show.title, year: show.year }, candidates })
  })

  // POST /api/metadata/movies/:id/match — manual or auto-match to a TMDB ID
  app.post<{ Params: { id: string }; Body: { tmdbId: number } }>(
    '/metadata/movies/:id/match',
    async (req, reply) => {
      const movie = await prisma.movie.findUnique({ where: { id: req.params.id } })
      if (!movie) return reply.code(404).send({ error: 'Movie not found' })

      const { tmdbId } = req.body
      if (!tmdbId || typeof tmdbId !== 'number') {
        return reply.code(400).send({ error: 'tmdbId is required' })
      }

      const client = await getTmdbClient()

      // Persist tmdbId before enrichment so it survives even if enrichment throws
      await prisma.movie.update({ where: { id: movie.id }, data: { tmdbId } })

      try {
        await enrichMovie(client, movie.id, tmdbId)
      } catch (err) {
        // Enrichment failure is non-fatal — the tmdbId is already saved
        app.log.error(err, `enrichMovie failed for movie ${movie.id} (tmdbId ${tmdbId}); match persisted`)
      }

      try {
        await writeMovieNfo(movie.id)
      } catch (err) {
        app.log.warn(err, `writeMovieNfo failed for movie ${movie.id}`)
      }
      try {
        await downloadMovieArtwork(movie.id, 'all', true)
      } catch (err) {
        app.log.warn(err, `downloadMovieArtwork failed for movie ${movie.id}`)
      }

      // Optional auto-cleanup: delete stale TMM/extra files after artwork is fresh.
      try {
        const autoCleanup = await getAutoCleanupSetting()
        if (autoCleanup) {
          const scan = await scanMovieFolder(movie.id)
          if (scan) {
            const toDelete = scan.files.filter((f) => BATCH_SAFE_TO_DELETE.has(f.category))
            await Promise.all(toDelete.map((f) => fs.unlink(f.path).catch(() => {})))
          }
        }
      } catch (err) {
        app.log.warn(err, `Auto-cleanup after match failed for movie ${movie.id}`)
      }

      const updated = await prisma.movie.findUnique({ where: { id: movie.id } })
      return reply.send(updated)
    },
  )

  // POST /api/metadata/shows/:id/match
  app.post<{ Params: { id: string }; Body: { tmdbId: number } }>(
    '/metadata/shows/:id/match',
    async (req, reply) => {
      const show = await prisma.tvShow.findUnique({ where: { id: req.params.id } })
      if (!show) return reply.code(404).send({ error: 'Show not found' })

      const { tmdbId } = req.body
      if (!tmdbId || typeof tmdbId !== 'number') {
        return reply.code(400).send({ error: 'tmdbId is required' })
      }

      const client = await getTmdbClient()
      const tvdbClient = await getTvdbClientOrNull()

      // Persist tmdbId before enrichment so it survives even if enrichment throws
      await prisma.tvShow.update({ where: { id: show.id }, data: { tmdbId } })

      try {
        await enrichTvShow(client, show.id, tmdbId, tvdbClient)
      } catch (err) {
        // Enrichment failure is non-fatal — the tmdbId is already saved
        app.log.error(err, `enrichTvShow failed for show ${show.id} (tmdbId ${tmdbId}); match persisted`)
      }

      try {
        await downloadShowArtwork(show.id, 'all', true)
      } catch (err) {
        app.log.warn(err, `Post-match artwork download failed for show ${show.id}`)
      }

      const updated = await prisma.tvShow.findUnique({ where: { id: show.id } })
      return reply.send(updated)
    },
  )

  // POST /api/metadata/shows/:id/enrich — refresh metadata for an already-matched show
  app.post<{ Params: { id: string } }>('/metadata/shows/:id/enrich', async (req, reply) => {
    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })
    if (!show.tmdbId) return reply.code(422).send({ error: 'Show is not matched to TMDB' })

    const client = await getTmdbClient()
    const tvdbClient = await getTvdbClientOrNull()

    try {
      await enrichTvShow(client, show.id, show.tmdbId, tvdbClient)
    } catch (err) {
      app.log.error(err, `enrichTvShow failed for show ${show.id}`)
      return reply.code(500).send({ error: 'Enrichment failed' })
    }

    try {
      await downloadShowArtwork(show.id, 'all', true)
    } catch (err) {
      app.log.warn(err, `Post-enrich artwork download failed for show ${show.id}`)
    }

    const updated = await prisma.tvShow.findUnique({ where: { id: show.id } })
    return reply.send(updated)
  })

  // PUT /api/metadata/movies/:id — manual field override
  app.put<{
    Params: { id: string }
    Body: {
      title?: string; year?: number; overview?: string; tagline?: string
      rating?: number; runtime?: number; posterUrl?: string; backdropUrl?: string
    }
  }>('/metadata/movies/:id', async (req, reply) => {
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })

    const updated = await prisma.movie.update({
      where: { id: req.params.id },
      data: req.body,
    })
    return reply.send(updated)
  })

  // PUT /api/metadata/shows/:id — manual field override (including tvdbId)
  app.put<{
    Params: { id: string }
    Body: { title?: string; year?: number; overview?: string; posterUrl?: string; backdropUrl?: string; tvdbId?: number | null }
  }>('/metadata/shows/:id', async (req, reply) => {
    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    const { tvdbId, ...rest } = req.body
    const tvdbIdChanged = tvdbId !== undefined && tvdbId !== show.tvdbId

    const updated = await prisma.tvShow.update({
      where: { id: req.params.id },
      data: tvdbId !== undefined ? { ...rest, tvdbId } : rest,
    })

    // Re-enrich episode metadata when tvdbId is manually changed
    if (tvdbIdChanged && show.tmdbId) {
      const client = await getTmdbClient().catch(() => null)
      const tvdbClient = await getTvdbClientOrNull()
      if (client) {
        enrichTvShow(client, show.id, show.tmdbId, tvdbClient).catch((err: unknown) => {
          app.log.warn(err, `Background re-enrich after tvdbId change for show ${show.id}`)
        })
      }
    }

    return reply.send(updated)
  })
}

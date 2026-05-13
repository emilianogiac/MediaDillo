import { access } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { getSchedule, setSchedule } from '../scheduler/index.js'
import type { ScheduleInterval } from '../scheduler/index.js'
import { getApiConfig, invalidateApiConfigCache, API_CONFIG_DB_KEYS } from '../api-config.js'
import { testJellyfinConnection } from '../jellyfin/client.js'

const VALID_INTERVALS = new Set<ScheduleInterval>(['disabled', '1h', '6h', '12h', '24h'])
const AUTO_CLEANUP_KEY = 'match.autoCleanupFolder'

function maskKey(key: string | undefined): string {
  if (!key) return ''
  if (key.length <= 4) return '****'
  return `****${key.slice(-4)}`
}

async function testTmdbKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${apiKey}`, {
      headers: { Accept: 'application/json' },
    })
    return res.ok
  } catch {
    return false
  }
}

async function testTvdbKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api4.thetvdb.com/v4/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ apikey: apiKey }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function getAutoCleanupSetting(): Promise<boolean> {
  const s = await prisma.setting.findUnique({ where: { key: AUTO_CLEANUP_KEY } })
  return s?.value === 'true'
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/settings/schedule
  app.get('/settings/schedule', async (_req, reply) => {
    const schedule = await getSchedule()
    return reply.send({ schedule })
  })

  // PUT /api/settings/schedule
  app.put<{ Body: { schedule: string } }>('/settings/schedule', async (req, reply) => {
    const { schedule } = req.body
    if (!VALID_INTERVALS.has(schedule as ScheduleInterval)) {
      return reply.code(400).send({ error: `Invalid schedule. Valid values: ${[...VALID_INTERVALS].join(', ')}` })
    }
    await setSchedule(schedule as ScheduleInterval)
    return reply.send({ schedule })
  })

  // GET /api/settings/auto-cleanup
  app.get('/settings/auto-cleanup', async (_req, reply) => {
    const enabled = await getAutoCleanupSetting()
    return reply.send({ enabled })
  })

  // PUT /api/settings/auto-cleanup
  app.put<{ Body: { enabled: boolean } }>('/settings/auto-cleanup', async (req, reply) => {
    const val = req.body.enabled ? 'true' : 'false'
    await prisma.setting.upsert({
      where: { key: AUTO_CLEANUP_KEY },
      create: { key: AUTO_CLEANUP_KEY, value: val },
      update: { value: val },
    })
    return reply.send({ enabled: req.body.enabled })
  })

  // GET /api/settings/scan-roots — all roots (including disabled)
  app.get('/settings/scan-roots', async (_req, reply) => {
    const roots = await prisma.scanRoot.findMany({ orderBy: { label: 'asc' } })
    return reply.send(roots)
  })

  // POST /api/settings/scan-roots
  app.post<{
    Body: { path: string; label: string; type: 'movies' | 'tv' }
  }>('/settings/scan-roots', async (req, reply) => {
    const { path, label, type } = req.body
    if (!path || !label || !type) {
      return reply.code(400).send({ error: 'path, label, and type are required' })
    }
    const existing = await prisma.scanRoot.findUnique({ where: { path } })
    if (existing) return reply.code(409).send({ error: 'A scan root with this path already exists' })

    const root = await prisma.scanRoot.create({ data: { path, label, type, enabled: true } })
    return reply.code(201).send(root)
  })

  // PATCH /api/settings/scan-roots/:id
  app.patch<{
    Params: { id: string }
    Body: { label?: string; type?: 'movies' | 'tv'; enabled?: boolean }
  }>('/settings/scan-roots/:id', async (req, reply) => {
    const root = await prisma.scanRoot.findUnique({ where: { id: req.params.id } })
    if (!root) return reply.code(404).send({ error: 'Scan root not found' })

    const updated = await prisma.scanRoot.update({
      where: { id: req.params.id },
      data: req.body,
    })
    return reply.send(updated)
  })

  // DELETE /api/settings/scan-roots/:id
  app.delete<{ Params: { id: string } }>('/settings/scan-roots/:id', async (req, reply) => {
    const root = await prisma.scanRoot.findUnique({ where: { id: req.params.id } })
    if (!root) return reply.code(404).send({ error: 'Scan root not found' })
    await prisma.scanRoot.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // POST /api/settings/verify-integrity — remove stale DB records
  // Stale = files missing from disk, OR item belongs to a library that is no longer configured/enabled.
  app.post('/settings/verify-integrity', async (_req, reply) => {
    let moviesRemoved = 0
    let showsRemoved = 0
    let episodesLost = 0

    // Collect enabled scan root path prefixes for the "dead library" check
    const enabledRoots = await prisma.scanRoot.findMany({ where: { enabled: true }, select: { path: true } })
    const enabledPrefixes = enabledRoots.map((r) => r.path.endsWith('/') ? r.path : r.path + '/')
    const inEnabledRoot = (filePath: string) => enabledPrefixes.some((p) => filePath.startsWith(p))

    // ── Movies ────────────────────────────────────────────────────────────────

    const movieFiles = await prisma.movieFile.findMany({
      select: { id: true, path: true, movieId: true },
    })

    const missingMovieFileIds: string[] = []
    const deadLibraryMovieFileIds: string[] = []
    const affectedMovieIds = new Set<string>()

    for (const f of movieFiles) {
      if (!inEnabledRoot(f.path)) {
        deadLibraryMovieFileIds.push(f.id)
        affectedMovieIds.add(f.movieId)
        continue
      }
      try { await access(f.path) } catch {
        missingMovieFileIds.push(f.id)
        affectedMovieIds.add(f.movieId)
      }
    }

    const removeMovieFileIds = [...missingMovieFileIds, ...deadLibraryMovieFileIds]
    if (removeMovieFileIds.length > 0) {
      await prisma.movieFile.deleteMany({ where: { id: { in: removeMovieFileIds } } })
      for (const movieId of affectedMovieIds) {
        const remaining = await prisma.movieFile.count({ where: { movieId } })
        if (remaining === 0) {
          await prisma.movie.delete({ where: { id: movieId } })
          moviesRemoved++
        }
      }
    }

    // Ghost movies — owned records with no files (e.g. after a title-change re-scan)
    const ghostMovies = await prisma.movie.findMany({
      where: { status: 'owned', files: { none: {} } },
      select: { id: true },
    })
    if (ghostMovies.length > 0) {
      await prisma.movie.deleteMany({ where: { id: { in: ghostMovies.map((m) => m.id) } } })
      moviesRemoved += ghostMovies.length
    }

    // ── TV Shows ──────────────────────────────────────────────────────────────

    const episodeFiles = await prisma.episodeFile.findMany({
      select: { id: true, path: true, episodeId: true },
    })

    const missingEpisodeFileIds: string[] = []
    const deadLibraryEpisodeFileIds: string[] = []
    const affectedEpisodeIds = new Set<string>()

    for (const f of episodeFiles) {
      if (!inEnabledRoot(f.path)) {
        deadLibraryEpisodeFileIds.push(f.id)
        affectedEpisodeIds.add(f.episodeId)
        continue
      }
      try { await access(f.path) } catch {
        missingEpisodeFileIds.push(f.id)
        affectedEpisodeIds.add(f.episodeId)
      }
    }

    const removeEpisodeFileIds = [...missingEpisodeFileIds, ...deadLibraryEpisodeFileIds]
    if (removeEpisodeFileIds.length > 0) {
      await prisma.episodeFile.deleteMany({ where: { id: { in: removeEpisodeFileIds } } })
      for (const episodeId of affectedEpisodeIds) {
        const remaining = await prisma.episodeFile.count({ where: { episodeId } })
        if (remaining === 0) {
          await prisma.episode.update({ where: { id: episodeId }, data: { status: 'missing' } })
          episodesLost++
        }
      }

      // Recalculate owned counts for affected shows
      const affectedEps = await prisma.episode.findMany({
        where: { id: { in: [...affectedEpisodeIds] } },
        select: { season: { select: { showId: true } } },
      })
      const affectedShowIds = [...new Set(affectedEps.map((e) => e.season.showId))]
      for (const showId of affectedShowIds) {
        const owned = await prisma.episode.count({ where: { season: { showId }, status: 'owned' } })
        await prisma.tvShow.update({ where: { id: showId }, data: { ownedEpisodes: owned } })
      }
    }

    // Ghost shows — shows with no episode files at all (delete show + seasons + episodes cascade)
    const showIdsWithFiles = new Set(
      (await prisma.episodeFile.findMany({
        select: { episode: { select: { season: { select: { showId: true } } } } },
      })).map((f) => f.episode.season.showId),
    )
    const ghostShows = await prisma.tvShow.findMany({ select: { id: true } })
    const ghostShowIds = ghostShows.map((s) => s.id).filter((id) => !showIdsWithFiles.has(id))
    if (ghostShowIds.length > 0) {
      await prisma.tvShow.deleteMany({ where: { id: { in: ghostShowIds } } })
      showsRemoved += ghostShowIds.length
    }

    return reply.send({ moviesRemoved, showsRemoved, episodesLost })
  })

  // POST /api/settings/dedup-shows — merge duplicate TvShow records with the same title
  // Caused by inconsistent year inclusion in episode filenames.
  app.post('/settings/dedup-shows', async (_req, reply) => {
    // Group all shows by title
    const allShows = await prisma.tvShow.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        seasons: {
          include: { episodes: { include: { files: true } } },
        },
      },
    })

    const byTitle = new Map<string, typeof allShows>()
    for (const show of allShows) {
      const key = show.title.toLowerCase().trim()
      const group = byTitle.get(key) ?? []
      group.push(show)
      byTitle.set(key, group)
    }

    let merged = 0
    let deleted = 0

    for (const group of byTitle.values()) {
      if (group.length < 2) continue

      // Pick the canonical record: prefer one with tmdbId, then most metadata, then oldest
      const score = (s: typeof allShows[number]) =>
        (s.tmdbId ? 10 : 0) + (s.year ? 2 : 0) + (s.overview ? 1 : 0) + (s.posterDownloaded ? 1 : 0)
      const canonical = [...group].sort((a, b) => score(b) - score(a))[0]!

      const duplicates = group.filter((s) => s.id !== canonical.id)

      for (const dup of duplicates) {
        for (const dupSeason of dup.seasons) {
          const existingSeason = await prisma.season.findFirst({
            where: { showId: canonical.id, seasonNumber: dupSeason.seasonNumber },
          })

          if (!existingSeason) {
            // No conflict — just re-parent the season
            await prisma.season.update({
              where: { id: dupSeason.id },
              data: { showId: canonical.id },
            })
          } else {
            // Season already exists in canonical — move episodes over
            for (const dupEp of dupSeason.episodes) {
              const existingEp = await prisma.episode.findFirst({
                where: { seasonId: existingSeason.id, episodeNumber: dupEp.episodeNumber },
              })
              if (!existingEp) {
                await prisma.episode.update({
                  where: { id: dupEp.id },
                  data: { seasonId: existingSeason.id },
                })
              } else {
                // Episode exists — move any files from the duplicate episode
                for (const f of dupEp.files) {
                  await prisma.episodeFile.update({
                    where: { id: f.id },
                    data: { episodeId: existingEp.id },
                  })
                }
                await prisma.episode.delete({ where: { id: dupEp.id } })
              }
            }
            await prisma.season.delete({ where: { id: dupSeason.id } })
          }
        }
        await prisma.tvShow.delete({ where: { id: dup.id } })
        deleted++
        merged++
      }
    }

    // Recalculate episode counts for all remaining shows
    const shows = await prisma.tvShow.findMany({ select: { id: true } })
    for (const s of shows) {
      const owned = await prisma.episode.count({ where: { season: { showId: s.id }, status: 'owned' } })
      const total = await prisma.episode.count({ where: { season: { showId: s.id } } })
      await prisma.tvShow.update({ where: { id: s.id }, data: { ownedEpisodes: owned, totalEpisodes: total } })
    }

    return reply.send({ merged, deleted })
  })

  // GET /api/settings/api-keys — returns all values masked (last 4 chars only)
  app.get('/settings/api-keys', async (_req, reply) => {
    const cfg = await getApiConfig()
    return reply.send({
      tmdbApiKey: maskKey(cfg.tmdbApiKey),
      tvdbApiKey: maskKey(cfg.tvdbApiKey),
      jellyfinUrl: cfg.jellyfinUrl ?? '',
      jellyfinApiKey: maskKey(cfg.jellyfinApiKey),
      metadataLanguage: cfg.metadataLanguage,
    })
  })

  // PUT /api/settings/api-keys — partial update, auto-validates, invalidates cache
  app.put<{
    Body: {
      tmdbApiKey?: string
      tvdbApiKey?: string
      jellyfinUrl?: string
      jellyfinApiKey?: string
      metadataLanguage?: string
    }
  }>('/settings/api-keys', async (req, reply) => {
    const { tmdbApiKey, tvdbApiKey, jellyfinUrl, jellyfinApiKey, metadataLanguage } = req.body

    if (tmdbApiKey) {
      const valid = await testTmdbKey(tmdbApiKey)
      if (!valid) return reply.code(422).send({ error: 'TMDB API key is invalid — could not connect to TMDB.' })
    }

    if (tvdbApiKey) {
      const valid = await testTvdbKey(tvdbApiKey)
      if (!valid) return reply.code(422).send({ error: 'TVDB API key is invalid — could not authenticate with TVDB.' })
    }

    if (jellyfinUrl || jellyfinApiKey) {
      const cfg = await getApiConfig()
      const url = jellyfinUrl ?? cfg.jellyfinUrl
      const key = jellyfinApiKey ?? cfg.jellyfinApiKey
      if (url && key) {
        const status = await testJellyfinConnection(url, key)
        if (!status.connected) {
          return reply.code(422).send({ error: `Jellyfin connection failed: ${status.error ?? 'unknown error'}` })
        }
      }
    }

    const updates: Array<[string, string]> = []
    if (tmdbApiKey !== undefined) updates.push([API_CONFIG_DB_KEYS.tmdbApiKey, tmdbApiKey])
    if (tvdbApiKey !== undefined) updates.push([API_CONFIG_DB_KEYS.tvdbApiKey, tvdbApiKey])
    if (jellyfinUrl !== undefined) updates.push([API_CONFIG_DB_KEYS.jellyfinUrl, jellyfinUrl])
    if (jellyfinApiKey !== undefined) updates.push([API_CONFIG_DB_KEYS.jellyfinApiKey, jellyfinApiKey])
    if (metadataLanguage !== undefined) updates.push([API_CONFIG_DB_KEYS.metadataLanguage, metadataLanguage])

    for (const [key, value] of updates) {
      await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
    }

    invalidateApiConfigCache()
    return reply.send({ ok: true })
  })

  // GET /api/settings/scan-logs — recent scan history
  app.get<{ Querystring: { limit?: string } }>('/settings/scan-logs', async (req, reply) => {
    const limit = Math.min(Number(req.query.limit ?? 10), 50)
    const logs = await prisma.scanLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        rootsScanned: true,
        filesAdded: true,
        filesChanged: true,
        filesRemoved: true,
        staleFilesFound: true,
      },
    })
    return reply.send(logs)
  })
}

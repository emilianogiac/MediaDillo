import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { getSchedule, setSchedule } from '../scheduler/index.js'
import type { ScheduleInterval } from '../scheduler/index.js'

const VALID_INTERVALS = new Set<ScheduleInterval>(['disabled', '1h', '6h', '12h', '24h'])

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

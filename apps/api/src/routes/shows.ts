import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'

export async function showsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/shows?search=&qualityTier=&missingArtwork=&unmatched=&duplicates=only|hide
  app.get<{
    Querystring: {
      search?: string
      qualityTier?: string
      missingArtwork?: string
      unmatched?: string
      duplicates?: string
    }
  }>('/shows', async (req, reply) => {
    const { search, qualityTier, missingArtwork, unmatched, duplicates } = req.query

    const dupGroups = duplicates
      ? await prisma.tvShow.groupBy({
          by: ['tmdbId'],
          where: { tmdbId: { not: null } },
          having: { tmdbId: { _count: { gt: 1 } } },
        })
      : []
    const dupTmdbIds = dupGroups.map((g) => g.tmdbId as number)

    const shows = await prisma.tvShow.findMany({
      where: {
        ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
        ...(qualityTier
          ? {
              seasons: {
                some: {
                  episodes: {
                    some: { files: { some: { videoQualityTier: qualityTier } } },
                  },
                },
              },
            }
          : {}),
        ...(missingArtwork === 'true'
          ? { OR: [{ posterDownloaded: false }, { backdropDownloaded: false }] }
          : {}),
        ...(unmatched === 'true' ? { tmdbId: null } : {}),
        ...(duplicates === 'only' && dupTmdbIds.length > 0 ? { tmdbId: { in: dupTmdbIds } } : {}),
        ...(duplicates === 'hide' && dupTmdbIds.length > 0 ? { NOT: { tmdbId: { in: dupTmdbIds } } } : {}),
      },
      select: {
        id: true,
        title: true,
        year: true,
        posterUrl: true,
        genres: true,
        rating: true,
        tmdbId: true,
        posterDownloaded: true,
        backdropDownloaded: true,
        status: true,
        ownedEpisodes: true,
        totalEpisodes: true,
      },
      orderBy: { title: 'asc' },
    })

    const dupSet = new Set(dupTmdbIds)
    const tagged = shows.map((s) => ({ ...s, isDuplicate: s.tmdbId != null && dupSet.has(s.tmdbId) }))

    return reply.send(tagged)
  })

  // GET /api/shows/:id — full detail with seasons + credits
  app.get<{ Params: { id: string } }>('/shows/:id', async (req, reply) => {
    const show = await prisma.tvShow.findUnique({
      where: { id: req.params.id },
      include: {
        seasons: {
          orderBy: { seasonNumber: 'asc' },
          include: {
            _count: { select: { episodes: { where: { status: 'owned' } } } },
          },
        },
        credits: {
          include: { person: true },
          orderBy: { role: 'asc' },
        },
      },
    })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    // Flatten seasons to include ownedCount
    const seasons = show.seasons.map((s) => ({
      id: s.id,
      seasonNumber: s.seasonNumber,
      episodeCount: s.episodeCount,
      ownedCount: s._count.episodes,
    }))

    return reply.send({ ...show, seasons })
  })

  // GET /api/shows/:id/seasons/:seasonNumber — season detail with episodes + files
  app.get<{ Params: { id: string; seasonNumber: string } }>(
    '/shows/:id/seasons/:seasonNumber',
    async (req, reply) => {
      const seasonNumber = parseInt(req.params.seasonNumber, 10)
      if (isNaN(seasonNumber)) return reply.code(400).send({ error: 'Invalid season number' })

      const season = await prisma.season.findFirst({
        where: { showId: req.params.id, seasonNumber },
        include: {
          show: { select: { id: true, title: true, year: true } },
          episodes: {
            orderBy: { episodeNumber: 'asc' },
            include: { files: { orderBy: { path: 'asc' } } },
          },
        },
      })
      if (!season) return reply.code(404).send({ error: 'Season not found' })

      return reply.send(season)
    },
  )
}

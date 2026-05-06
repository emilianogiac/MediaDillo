import path from 'node:path'
import { readdir } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { previewEpisodeRenames, applyEpisodeRenames, deleteToTrash, type RenamePreviewItem } from '../files/rename.js'
import { detectStaleFiles } from '../scanner/stale-detector.js'

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

  // GET /api/shows/:id/organize — rename preview + stale file scan for this show
  app.get<{ Params: { id: string } }>('/shows/:id/organize', async (req, reply) => {
    const show = await prisma.tvShow.findUnique({
      where: { id: req.params.id },
      include: {
        seasons: {
          include: { episodes: { include: { files: { select: { path: true } } } } },
        },
      },
    })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    // Derive show folder from first episode file (2 levels up)
    const firstFilePath = show.seasons
      .flatMap((s) => s.episodes.flatMap((e) => e.files.map((f) => f.path)))
      .sort()[0]
    if (!firstFilePath) return reply.send({ renames: [], removals: [] })

    const showFolder = path.dirname(path.dirname(firstFilePath))

    // Collect all DB-known video paths for this show
    const knownPaths = new Set(
      show.seasons.flatMap((s) => s.episodes.flatMap((e) => e.files.map((f) => f.path))),
    )

    // Walk show folder for stale detection
    const removals: Array<{ path: string; reason: string }> = []
    async function walkForStale(dir: string) {
      let entries: string[]
      try { entries = await readdir(dir) } catch { return }
      const staleInDir = await detectStaleFiles(dir, knownPaths)
      removals.push(...staleInDir)
      for (const entry of entries) {
        const full = path.join(dir, entry)
        // Recurse into season subfolders only
        if (!path.extname(entry)) {
          await walkForStale(full)
        }
      }
    }
    await walkForStale(showFolder)

    // Rename preview for this show
    const allRenames = await previewEpisodeRenames([req.params.id])
    const renames = allRenames.filter((r) => r.needsRename)

    return reply.send({ renames, removals, showFolder })
  })

  // POST /api/shows/:id/organize/apply — rename selected files + trash selected files
  app.post<{
    Params: { id: string }
    Body: { renames: string[]; trash: string[] }
  }>('/shows/:id/organize/apply', async (req, reply) => {
    const { renames, trash } = req.body

    let renamed = 0
    let trashed = 0
    const errors: string[] = []

    if (renames && renames.length > 0) {
      // Separate show-folder items (type: 'show-folder') from file items
      // by fetching the full preview and splitting
      const allItems = await previewEpisodeRenames([req.params.id])
      const showFolderItems = allItems.filter((i) => i.type === 'show-folder' && i.needsRename)
      const result = await applyEpisodeRenames(renames, showFolderItems)
      renamed = result.renamed
      errors.push(...result.errors)
    }

    for (const filePath of (trash ?? [])) {
      try {
        await deleteToTrash(filePath)
        trashed++
      } catch (err) {
        errors.push(`Trash failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return reply.send({ renamed, trashed, errors })
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

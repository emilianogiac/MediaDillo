import path from 'node:path'
import { readdir, rename as fsRename } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { previewEpisodeRenames, applyEpisodeRenames, deleteToTrash, type RenamePreviewItem } from '../files/rename.js'
import { detectStaleFiles } from '../scanner/stale-detector.js'
import { runSeasonScan, isScanRunning } from '../scanner/index.js'
import { canonicalEpisodeFileName } from '../files/naming.js'

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

  // POST /api/shows/:id/seasons/:seasonNumber/rescan — rescan a single season folder
  app.post<{ Params: { id: string; seasonNumber: string } }>(
    '/shows/:id/seasons/:seasonNumber/rescan',
    async (req, reply) => {
      if (isScanRunning()) return reply.code(409).send({ error: 'A full scan is already running' })
      const seasonNumber = parseInt(req.params.seasonNumber, 10)
      if (isNaN(seasonNumber)) return reply.code(400).send({ error: 'Invalid season number' })
      const counts = await runSeasonScan(req.params.id, seasonNumber)
      return reply.send(counts)
    },
  )

  // POST /api/shows/:id/seasons/:seasonNumber/merge-parts — merge two episodes into one multi-part episode
  app.post<{
    Params: { id: string; seasonNumber: string }
    Body: { primaryEpisode: number; secondaryEpisode: number }
  }>('/shows/:id/seasons/:seasonNumber/merge-parts', async (req, reply) => {
    const seasonNumber = parseInt(req.params.seasonNumber, 10)
    if (isNaN(seasonNumber)) return reply.code(400).send({ error: 'Invalid season number' })

    const { primaryEpisode, secondaryEpisode } = req.body
    if (!primaryEpisode || !secondaryEpisode || primaryEpisode === secondaryEpisode) {
      return reply.code(400).send({ error: 'primaryEpisode and secondaryEpisode must be different' })
    }

    // Load show for title
    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id }, select: { title: true } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    // Load season
    const season = await prisma.season.findFirst({
      where: { showId: req.params.id, seasonNumber },
    })
    if (!season) return reply.code(404).send({ error: 'Season not found' })

    // Load both episodes with files
    const [epA, epB] = await Promise.all([
      prisma.episode.findFirst({ where: { seasonId: season.id, episodeNumber: primaryEpisode }, include: { files: true } }),
      prisma.episode.findFirst({ where: { seasonId: season.id, episodeNumber: secondaryEpisode }, include: { files: true } }),
    ])
    if (!epA) return reply.code(404).send({ error: `Episode ${primaryEpisode} not found` })
    if (!epB) return reply.code(404).send({ error: `Episode ${secondaryEpisode} not found` })
    if (epA.files.length === 0) return reply.code(422).send({ error: `Episode ${primaryEpisode} has no files` })
    if (epB.files.length === 0) return reply.code(422).send({ error: `Episode ${secondaryEpisode} has no files` })

    const errors: string[] = []
    let renamed = 0

    // Rename primary files → part1
    for (const file of epA.files) {
      const ext = path.extname(file.path)
      const dir = path.dirname(file.path)
      const newName = canonicalEpisodeFileName(show.title, seasonNumber, primaryEpisode, epA.title, ext, null, 1)
      const newPath = path.join(dir, newName)
      try {
        await fsRename(file.path, newPath)
        await prisma.episodeFile.update({ where: { id: file.id }, data: { path: newPath } })
        renamed++
      } catch (err) {
        errors.push(`Rename failed for ${file.path}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Rename secondary files → part2 (using primary episode number and title)
    for (const file of epB.files) {
      const ext = path.extname(file.path)
      const dir = path.dirname(file.path)
      const newName = canonicalEpisodeFileName(show.title, seasonNumber, primaryEpisode, epA.title, ext, null, 2)
      const newPath = path.join(dir, newName)
      try {
        await fsRename(file.path, newPath)
        await prisma.episodeFile.update({ where: { id: file.id }, data: { path: newPath, episodeId: epA.id } })
        renamed++
      } catch (err) {
        errors.push(`Rename failed for ${file.path}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Delete secondary episode (files already re-parented)
    await prisma.episode.delete({ where: { id: epB.id } })

    // Recalculate show owned counts
    const owned = await prisma.episode.count({ where: { season: { showId: req.params.id }, status: 'owned' } })
    await prisma.tvShow.update({ where: { id: req.params.id }, data: { ownedEpisodes: owned } })

    return reply.send({ renamed, errors })
  })

  // POST /api/shows/:id/seasons/:seasonNumber/renumber — shift episode numbers by `shift` starting from `fromEpisode`
  app.post<{
    Params: { id: string; seasonNumber: string }
    Body: { fromEpisode: number; shift: number }
  }>('/shows/:id/seasons/:seasonNumber/renumber', async (req, reply) => {
    const seasonNumber = parseInt(req.params.seasonNumber, 10)
    if (isNaN(seasonNumber)) return reply.code(400).send({ error: 'Invalid season number' })

    const { fromEpisode, shift } = req.body
    if (!shift || shift === 0) return reply.code(400).send({ error: 'shift must be non-zero' })

    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id }, select: { title: true } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    const season = await prisma.season.findFirst({ where: { showId: req.params.id, seasonNumber } })
    if (!season) return reply.code(404).send({ error: 'Season not found' })

    // Load episodes to renumber, ordered DESC to avoid collision when shifting down
    const episodes = await prisma.episode.findMany({
      where: { seasonId: season.id, episodeNumber: { gte: fromEpisode } },
      include: { files: true },
      orderBy: { episodeNumber: shift < 0 ? 'asc' : 'desc' },
    })

    const errors: string[] = []
    let renamed = 0

    for (const ep of episodes) {
      const newEpNum = ep.episodeNumber + shift

      for (const file of ep.files) {
        const ext = path.extname(file.path)
        const dir = path.dirname(file.path)
        const newName = canonicalEpisodeFileName(show.title, seasonNumber, newEpNum, ep.title, ext)
        const newPath = path.join(dir, newName)
        if (newPath === file.path) continue
        try {
          await fsRename(file.path, newPath)
          await prisma.episodeFile.update({ where: { id: file.id }, data: { path: newPath } })
          renamed++
        } catch (err) {
          errors.push(`Rename failed for ${file.path}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      await prisma.episode.update({ where: { id: ep.id }, data: { episodeNumber: newEpNum } })
    }

    // Recalculate show owned counts
    const owned = await prisma.episode.count({ where: { season: { showId: req.params.id }, status: 'owned' } })
    await prisma.tvShow.update({ where: { id: req.params.id }, data: { ownedEpisodes: owned } })

    return reply.send({ renamed, errors })
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

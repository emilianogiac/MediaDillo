import path from 'node:path'
import fs from 'node:fs/promises'
import { readdir, rename as fsRename } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { prisma, EpisodeStatus } from '@mediadillo/db'
import { previewEpisodeRenames, previewEpisodeFileRenames, applyEpisodeRenames, deleteToTrash, type RenamePreviewItem } from '../files/rename.js'
import { detectStaleFiles } from '../scanner/stale-detector.js'
import { runSeasonScan, runShowScan, isScanRunning } from '../scanner/index.js'
import { canonicalEpisodeFileName, canonicalMovieFolderName } from '../files/naming.js'
import { TmdbClient } from '../metadata/tmdb-client.js'
import { TvdbClient } from '../metadata/tvdb-client.js'
import { syncSeasonTitles } from '../metadata/enricher.js'
import { getApiConfig } from '../api-config.js'
import { triggerLibraryRefresh } from '../jellyfin/sync.js'

export async function showsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/shows?search=&qualityTier=&missingArtwork=&unmatched=&duplicates=only|hide&organized=false&scanRootId=&status=continuing|ended
  app.get<{
    Querystring: {
      search?: string
      qualityTier?: string
      missingArtwork?: string
      unmatched?: string
      duplicates?: string
      organized?: string
      addedSince?: string
      scanRootId?: string
      status?: string
    }
  }>('/shows', async (req, reply) => {
    const { search, qualityTier, missingArtwork, unmatched, duplicates, organized, addedSince, scanRootId, status } = req.query

    // Always compute dup groups with count
    const dupGroups = await prisma.tvShow.groupBy({
      by: ['tmdbId'],
      where: { tmdbId: { not: null } },
      having: { tmdbId: { _count: { gt: 1 } } },
      _count: { tmdbId: true },
    })
    const dupCountMap = new Map<number, number>(
      dupGroups.map((g) => [g.tmdbId as number, g._count.tmdbId]),
    )
    const dupTmdbIds = [...dupCountMap.keys()]

    // Resolve scanRootId → path prefix for episode file filtering
    let scanRootPath: string | null = null
    if (scanRootId) {
      const root = await prisma.scanRoot.findUnique({ where: { id: scanRootId }, select: { path: true } })
      scanRootPath = root?.path ?? null
    }

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
        ...(addedSince ? { createdAt: { gte: new Date(addedSince) } } : {}),
        ...(scanRootPath ? { seasons: { some: { episodes: { some: { files: { some: { path: { startsWith: scanRootPath.endsWith('/') ? scanRootPath : scanRootPath + '/' } } } } } } } } : {}),
        ...(status === 'continuing' || status === 'ended' ? { status } : {}),
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
        createdAt: true,
        // First episode file path — used to derive show folder name for isOrganized
        seasons: {
          take: 1,
          select: {
            episodes: {
              take: 1,
              select: {
                files: { take: 1, select: { path: true } },
              },
            },
          },
        },
      },
      orderBy: { title: 'asc' },
    })

    function showFolderName(s: typeof shows[0]): string | null {
      const firstPath = s.seasons[0]?.episodes[0]?.files[0]?.path
      if (!firstPath) return null
      return path.basename(path.dirname(path.dirname(firstPath)))
    }

    function isShowOrganized(s: typeof shows[0]): boolean {
      if (!s.tmdbId) return false
      const folderName = showFolderName(s)
      return folderName === canonicalMovieFolderName(s.title, s.year)
    }

    let filtered = shows
    if (organized === 'false') {
      filtered = filtered.filter((s) => !isShowOrganized(s))
    }

    // Build a showId → scanRoots[] map by checking which scan roots each show has files in.
    const allScanRoots = await prisma.scanRoot.findMany({ select: { id: true, label: true, path: true } })
    const filteredIds = filtered.map((s) => s.id)
    const showScanRoots = new Map<string, { id: string; label: string }[]>()
    for (const root of allScanRoots) {
      const inRoot = await prisma.tvShow.findMany({
        where: {
          id: { in: filteredIds },
          seasons: { some: { episodes: { some: { files: { some: { path: { startsWith: root.path.endsWith('/') ? root.path : root.path + '/' } } } } } } },
        },
        select: { id: true },
      })
      for (const s of inRoot) {
        const arr = showScanRoots.get(s.id) ?? []
        arr.push({ id: root.id, label: root.label })
        showScanRoots.set(s.id, arr)
      }
    }

    const dupSet = new Set(dupTmdbIds)
    const tagged = filtered.map(({ seasons, ...rest }) => ({
      ...rest,
      isDuplicate: rest.tmdbId != null && dupSet.has(rest.tmdbId),
      duplicateCount: rest.tmdbId != null ? (dupCountMap.get(rest.tmdbId) ?? 1) : 1,
      isOrganized: isShowOrganized({ seasons, ...rest }),
      scanRoots: showScanRoots.get(rest.id) ?? [],
    }))

    return reply.send(tagged)
  })

  // DELETE /api/shows/:id — remove a stale record (cascade-deletes seasons/episodes/files via schema)
  app.delete<{ Params: { id: string } }>('/shows/:id', async (req, reply) => {
    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })
    await prisma.tvShow.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
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

    // Build scanRoots for this show (which scan roots contain its episode files)
    const allScanRoots = await prisma.scanRoot.findMany({ select: { id: true, label: true, path: true } })
    const showScanRoots: { id: string; label: string }[] = []
    for (const root of allScanRoots) {
      const rootPath = root.path.endsWith('/') ? root.path : root.path + '/'
      const hasFiles = await prisma.episodeFile.findFirst({
        where: { path: { startsWith: rootPath }, episode: { season: { showId: show.id } } },
        select: { id: true },
      })
      if (hasFiles) showScanRoots.push({ id: root.id, label: root.label })
    }

    // Duplicate detection for this show's tmdbId
    const dupCount = show.tmdbId
      ? await prisma.tvShow.count({ where: { tmdbId: show.tmdbId } })
      : 1

    return reply.send({
      ...show,
      seasons,
      scanRoots: showScanRoots,
      isDuplicate: dupCount > 1,
      duplicateCount: dupCount,
      isOrganized: false, // detail page doesn't use isOrganized; included for type compatibility
    })
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
        if (entry.startsWith('.')) continue  // skip .trash, .DS_Store, hidden dirs
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

    const showFolderItems: RenamePreviewItem[] = []
    if (renames && renames.length > 0) {
      const allItems = await previewEpisodeRenames([req.params.id])
      showFolderItems.push(...allItems.filter((i) => i.type === 'show-folder' && i.needsRename))
      const result = await applyEpisodeRenames(renames, showFolderItems)
      renamed = result.renamed
      errors.push(...result.errors)
    }

    // Remap trash paths if a show folder was renamed during the apply above
    const remappedTrash = (trash ?? []).map((p) => {
      for (const item of showFolderItems) {
        if (p.startsWith(item.currentPath + '/')) {
          return item.proposedPath + p.slice(item.currentPath.length)
        }
      }
      return p
    })

    for (const filePath of remappedTrash) {
      try {
        await deleteToTrash(filePath)
        trashed++
      } catch (err) {
        errors.push(`Trash failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return reply.send({ renamed, trashed, errors })
  })

  // POST /api/shows/:id/cleanup-stale — auto-trash all stale files in the show folder
  app.post<{ Params: { id: string } }>('/shows/:id/cleanup-stale', async (req, reply) => {
    const show = await prisma.tvShow.findUnique({
      where: { id: req.params.id },
      include: {
        seasons: {
          include: { episodes: { include: { files: { select: { path: true } } } } },
        },
      },
    })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    const firstFilePath = show.seasons
      .flatMap((s) => s.episodes.flatMap((e) => e.files.map((f) => f.path)))
      .sort()[0]
    if (!firstFilePath) return reply.send({ trashed: 0, errors: [] })

    const showFolder = path.dirname(path.dirname(firstFilePath))
    const knownPaths = new Set(
      show.seasons.flatMap((s) => s.episodes.flatMap((e) => e.files.map((f) => f.path))),
    )

    const stalePaths: string[] = []
    async function walkForStale(dir: string) {
      let entries: string[]
      try { entries = await readdir(dir) } catch { return }
      const staleInDir = await detectStaleFiles(dir, knownPaths)
      stalePaths.push(...staleInDir.map((s) => s.path))
      for (const entry of entries) {
        if (entry.startsWith('.')) continue
        const full = path.join(dir, entry)
        if (!path.extname(entry)) await walkForStale(full)
      }
    }
    await walkForStale(showFolder)

    let trashed = 0
    const errors: string[] = []
    for (const p of stalePaths) {
      try {
        await deleteToTrash(p)
        trashed++
      } catch (err) {
        errors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return reply.send({ trashed, errors })
  })

  // POST /api/shows/:id/rescan — rescan the entire show folder
  app.post<{ Params: { id: string } }>('/shows/:id/rescan', async (req, reply) => {
    if (isScanRunning()) return reply.code(409).send({ error: 'A full scan is already running' })
    const result = await runShowScan(req.params.id)
    return reply.send(result)
  })

  // POST /api/shows/:id/seasons/:seasonNumber/rescan — rescan a single season folder
  app.post<{ Params: { id: string; seasonNumber: string } }>(
    '/shows/:id/seasons/:seasonNumber/rescan',
    async (req, reply) => {
      if (isScanRunning()) return reply.code(409).send({ error: 'A full scan is already running' })
      const seasonNumber = parseInt(req.params.seasonNumber, 10)
      if (isNaN(seasonNumber)) return reply.code(400).send({ error: 'Invalid season number' })
      const result = await runSeasonScan(req.params.id, seasonNumber)
      return reply.send(result)
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

    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id }, select: { title: true, tmdbId: true } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    const season = await prisma.season.findFirst({ where: { showId: req.params.id, seasonNumber } })
    if (!season) return reply.code(404).send({ error: 'Season not found' })

    // Load episodes to renumber, ordered DESC to avoid collision when shifting down
    const episodes = await prisma.episode.findMany({
      where: { seasonId: season.id, episodeNumber: { gte: fromEpisode } },
      include: { files: { orderBy: { path: 'asc' } } },
      orderBy: { episodeNumber: shift < 0 ? 'asc' : 'desc' },
    })

    const errors: string[] = []
    let renamed = 0

    for (const ep of episodes) {
      const newEpNum = ep.episodeNumber + shift

      for (const file of ep.files) {
        const ext = path.extname(file.path)
        const dir = path.dirname(file.path)
        const fileIdx = ep.files.findIndex((f) => f.id === file.id)
        const partNumber = ep.files.length > 1 ? fileIdx + 1 : null
        const newName = canonicalEpisodeFileName(show.title, seasonNumber, newEpNum, ep.title, ext, file.multiEpisodeEnd ?? null, partNumber)
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

    // Refresh episode titles so they match the new numbering (TVDB if available, else TMDB)
    if (show.tmdbId) {
      try {
        const cfg = await getApiConfig()
        if (cfg.tmdbApiKey) {
          const tmdbClient = new TmdbClient(cfg.tmdbApiKey, cfg.metadataLanguage)
          const tvdbClient = cfg.tvdbApiKey ? new TvdbClient(cfg.tvdbApiKey) : null
          await syncSeasonTitles(tmdbClient, req.params.id, show.tmdbId, seasonNumber, tvdbClient)
        }
      } catch { /* non-fatal — titles will be correct after next rematch */ }
    }

    return reply.send({ renamed, errors })
  })

  // POST /api/shows/:id/seasons/:seasonNumber/reorder — reassign files to correct episode slots
  // episodeIds: desired order of episode IDs (owned episodes only, sorted by current episodeNumber).
  // The i-th episode's files are reassigned to the slot that originally held position i.
  // Two-phase rename (tmp → final) avoids collisions in circular swaps.
  app.post<{
    Params: { id: string; seasonNumber: string }
    Body: { episodeIds: string[] }
  }>('/shows/:id/seasons/:seasonNumber/reorder', async (req, reply) => {
    const seasonNumber = parseInt(req.params.seasonNumber, 10)
    if (isNaN(seasonNumber)) return reply.code(400).send({ error: 'Invalid season number' })

    const { episodeIds } = req.body
    if (!Array.isArray(episodeIds) || episodeIds.length < 2) {
      return reply.code(400).send({ error: 'episodeIds must have at least 2 entries' })
    }

    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id }, select: { title: true } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    const season = await prisma.season.findFirst({ where: { showId: req.params.id, seasonNumber } })
    if (!season) return reply.code(404).send({ error: 'Season not found' })

    // Load ALL episodes (owned + missing) sorted by episodeNumber — these are the canonical slots
    const episodes = await prisma.episode.findMany({
      where: { seasonId: season.id },
      include: { files: true },
      orderBy: { episodeNumber: 'asc' },
    })

    const allIds = new Set(episodes.map((e) => e.id))
    if (episodeIds.length !== episodes.length || !episodeIds.every((id) => allIds.has(id))) {
      return reply.code(400).send({ error: 'episodeIds must be exactly the full episode list for this season' })
    }

    // slotNumbers[i] = the episode number at position i (the target slot for episodeIds[i])
    const slotNumbers = episodes.map((e) => e.episodeNumber)
    const episodeByNumber = new Map(episodes.map((e) => [e.episodeNumber, e]))

    // Build assignments: which Episode record each source episode's files should move to
    const assignments = new Map<string, { targetEpisode: (typeof episodes)[0] }>()
    episodeIds.forEach((epId, i) => {
      const target = episodeByNumber.get(slotNumbers[i]!)!
      assignments.set(epId, { targetEpisode: target })
    })

    // Only process episodes that have files AND need to move
    const toMove = episodes.filter((ep) => ep.files.length > 0 && assignments.get(ep.id)!.targetEpisode.id !== ep.id)
    if (toMove.length === 0) return reply.send({ renamed: 0, errors: [] })

    const errors: string[] = []
    let renamed = 0

    // Collect all files with their target info
    const fileJobs = toMove.flatMap((ep) =>
      ep.files.map((f) => ({ file: f, target: assignments.get(ep.id)!.targetEpisode })),
    )

    // Phase 1: rename to tmp names to avoid collision
    const tmpPaths = new Map<string, string>() // fileId → tmpPath
    for (const { file } of fileJobs) {
      const ext = path.extname(file.path)
      const dir = path.dirname(file.path)
      const tmpPath = path.join(dir, `.tmp-${file.id}${ext}`)
      try {
        await fsRename(file.path, tmpPath)
        tmpPaths.set(file.id, tmpPath)
        await prisma.episodeFile.update({ where: { id: file.id }, data: { path: tmpPath } })
      } catch (err) {
        errors.push(`tmp rename failed for ${path.basename(file.path)}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Reassign EpisodeFile → target Episode in DB
    for (const { file, target } of fileJobs) {
      if (!tmpPaths.has(file.id)) continue
      await prisma.episodeFile.update({ where: { id: file.id }, data: { episodeId: target.id } })
    }

    // Group successful fileJobs by target episode (sorted by original path) for part numbering
    const jobsByTarget = new Map<string, Array<{ file: (typeof fileJobs)[0]['file']; target: (typeof fileJobs)[0]['target'] }>>()
    for (const job of fileJobs) {
      if (!tmpPaths.has(job.file.id)) continue
      if (!jobsByTarget.has(job.target.id)) jobsByTarget.set(job.target.id, [])
      jobsByTarget.get(job.target.id)!.push(job)
    }
    for (const jobs of jobsByTarget.values()) {
      jobs.sort((a, b) => (a.file.path < b.file.path ? -1 : 1))
    }

    // Phase 2: rename tmp → canonical final name
    for (const { file, target } of fileJobs) {
      const tmpPath = tmpPaths.get(file.id)
      if (!tmpPath) continue
      const ext = path.extname(file.path)
      const dir = path.dirname(tmpPath)
      const targetJobs = jobsByTarget.get(target.id)!
      const fileIdx = targetJobs.findIndex((j) => j.file.id === file.id)
      const partNumber = targetJobs.length > 1 ? fileIdx + 1 : null
      const finalName = canonicalEpisodeFileName(
        show.title, seasonNumber, target.episodeNumber, target.title, ext, file.multiEpisodeEnd ?? null, partNumber,
      )
      const finalPath = path.join(dir, finalName)
      try {
        await fsRename(tmpPath, finalPath)
        await prisma.episodeFile.update({ where: { id: file.id }, data: { path: finalPath } })
        renamed++
      } catch (err) {
        errors.push(`final rename failed for ${path.basename(tmpPath)}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    triggerLibraryRefresh(app.log).catch(() => {})
    return reply.send({ renamed, errors })
  })

  // POST /api/shows/:id/cross-reassign — move files across seasons (and within season)
  // moves: [{ fromEpisodeId, toEpisodeId }] — each entry moves all files from source to target episode.
  app.post<{ Params: { id: string }; Body: { moves: { fromEpisodeId: string; toEpisodeId: string }[] } }>(
    '/shows/:id/cross-reassign',
    async (req, reply) => {
      const { moves } = req.body
      if (!Array.isArray(moves) || moves.length === 0) {
        return reply.code(400).send({ error: 'moves must be a non-empty array' })
      }

      const show = await prisma.tvShow.findUnique({ where: { id: req.params.id }, select: { title: true } })
      if (!show) return reply.code(404).send({ error: 'Show not found' })

      const allEpisodeIds = [...new Set([...moves.map(m => m.fromEpisodeId), ...moves.map(m => m.toEpisodeId)])]
      const episodes = await prisma.episode.findMany({
        where: { id: { in: allEpisodeIds }, season: { showId: req.params.id } },
        include: { files: true, season: { select: { seasonNumber: true } } },
      })

      if (episodes.length !== allEpisodeIds.length) {
        return reply.code(400).send({ error: 'One or more episode IDs are invalid or belong to a different show' })
      }

      const epMap = new Map(episodes.map(e => [e.id, e]))

      // Collect file jobs: which file moves to which target episode
      const fileJobs: Array<{ file: (typeof episodes)[0]['files'][0]; target: (typeof episodes)[0] }> = []
      for (const move of moves) {
        const src = epMap.get(move.fromEpisodeId)!
        const tgt = epMap.get(move.toEpisodeId)!
        for (const file of src.files) {
          fileJobs.push({ file, target: tgt })
        }
      }

      if (fileJobs.length === 0) return reply.send({ renamed: 0, errors: [] })

      const errors: string[] = []
      let renamed = 0

      // Phase 1: rename all files to tmp names to avoid collision
      const tmpPaths = new Map<string, string>()
      for (const { file } of fileJobs) {
        const ext = path.extname(file.path)
        const dir = path.dirname(file.path)
        const tmpPath = path.join(dir, `.tmp-${file.id}${ext}`)
        try {
          await fsRename(file.path, tmpPath)
          tmpPaths.set(file.id, tmpPath)
          await prisma.episodeFile.update({ where: { id: file.id }, data: { path: tmpPath } })
        } catch (err) {
          errors.push(`tmp rename failed for ${path.basename(file.path)}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Reassign EpisodeFile → target Episode
      for (const { file, target } of fileJobs) {
        if (!tmpPaths.has(file.id)) continue
        await prisma.episodeFile.update({ where: { id: file.id }, data: { episodeId: target.id } })
      }

      // Group by target for part numbering
      const jobsByTarget = new Map<string, Array<typeof fileJobs[0]>>()
      for (const job of fileJobs) {
        if (!tmpPaths.has(job.file.id)) continue
        if (!jobsByTarget.has(job.target.id)) jobsByTarget.set(job.target.id, [])
        jobsByTarget.get(job.target.id)!.push(job)
      }
      for (const jobs of jobsByTarget.values()) jobs.sort((a, b) => (a.file.path < b.file.path ? -1 : 1))

      // Phase 2: rename tmp → canonical final name using target episode's season
      for (const { file, target } of fileJobs) {
        const tmpPath = tmpPaths.get(file.id)
        if (!tmpPath) continue
        const ext = path.extname(file.path)
        const dir = path.dirname(tmpPath)
        const targetJobs = jobsByTarget.get(target.id)!
        const fileIdx = targetJobs.findIndex(j => j.file.id === file.id)
        const partNumber = targetJobs.length > 1 ? fileIdx + 1 : null
        const finalName = canonicalEpisodeFileName(
          show.title, target.season.seasonNumber, target.episodeNumber, target.title, ext,
          file.multiEpisodeEnd ?? null, partNumber,
        )
        const finalPath = path.join(dir, finalName)
        try {
          await fsRename(tmpPath, finalPath)
          await prisma.episodeFile.update({ where: { id: file.id }, data: { path: finalPath } })
          renamed++
        } catch (err) {
          errors.push(`final rename failed for ${path.basename(tmpPath)}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Update episode statuses for affected source and target episodes
      const movedFromIds = new Set(moves.map(m => m.fromEpisodeId))
      const movedToIds = new Set(moves.map(m => m.toEpisodeId))
      const affected = await prisma.episode.findMany({
        where: { id: { in: [...movedFromIds, ...movedToIds] } },
        include: { files: true },
      })
      for (const ep of affected) {
        const today = new Date()
        let status: EpisodeStatus
        if (ep.files.length > 0) {
          status = EpisodeStatus.owned
        } else if (ep.airDate && new Date(ep.airDate) > today) {
          status = EpisodeStatus.not_yet_aired
        } else {
          status = EpisodeStatus.missing
        }
        await prisma.episode.update({ where: { id: ep.id }, data: { status } })
      }

      triggerLibraryRefresh(app.log).catch(() => {})
      return reply.send({ renamed, errors })
    },
  )

  // GET /api/shows/:id/seasons/:seasonNumber/rename-preview — canonical rename preview scoped to a season
  app.get<{ Params: { id: string; seasonNumber: string } }>(
    '/shows/:id/seasons/:seasonNumber/rename-preview',
    async (req, reply) => {
      const seasonNumber = parseInt(req.params.seasonNumber, 10)
      if (isNaN(seasonNumber)) return reply.code(400).send({ error: 'Invalid season number' })

      const season = await prisma.season.findFirst({
        where: { showId: req.params.id, seasonNumber },
        include: { episodes: { include: { files: { select: { id: true } } } } },
      })
      if (!season) return reply.code(404).send({ error: 'Season not found' })

      const fileIds = season.episodes.flatMap((e) => e.files.map((f) => f.id))
      const items = await previewEpisodeFileRenames(fileIds)
      return reply.send(items)
    },
  )

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

  // POST /api/shows/:id/move — move show folder to a different scan root
  app.post<{ Params: { id: string }; Body: { targetScanRootId: string } }>(
    '/shows/:id/move',
    async (req, reply) => {
      const show = await prisma.tvShow.findUnique({ where: { id: req.params.id } })
      if (!show) return reply.code(404).send({ error: 'Show not found' })

      const targetRoot = await prisma.scanRoot.findUnique({ where: { id: req.body.targetScanRootId } })
      if (!targetRoot) return reply.code(404).send({ error: 'Target scan root not found' })
      if (targetRoot.type !== 'tv') return reply.code(422).send({ error: 'Target must be a tv-type scan root' })

      // Derive show folder from any episode file (2 levels up: show/Season XX/episode.mkv)
      const anyFile = await prisma.episodeFile.findFirst({
        where: { episode: { season: { showId: show.id } } },
        select: { path: true },
      })
      if (!anyFile) return reply.code(422).send({ error: 'Show has no files to move' })

      const showFolder = path.dirname(path.dirname(anyFile.path))
      const folderName = path.basename(showFolder)
      const newShowFolder = path.join(targetRoot.path, folderName)

      if (showFolder === newShowFolder) return reply.code(422).send({ error: 'Already in this collection' })

      try {
        await fs.rename(showFolder, newShowFolder)
      } catch (err) {
        return reply.code(500).send({ error: `Failed to move folder: ${err instanceof Error ? err.message : String(err)}` })
      }

      // Update all episode file paths
      const allFiles = await prisma.episodeFile.findMany({
        where: { path: { startsWith: showFolder + '/' } },
        select: { id: true, path: true },
      })
      await Promise.all(
        allFiles.map((f) =>
          prisma.episodeFile.update({
            where: { id: f.id },
            data: { path: f.path.replace(showFolder, newShowFolder) },
          }),
        ),
      )

      return reply.send({ moved: true, newFolder: newShowFolder })
    },
  )
}

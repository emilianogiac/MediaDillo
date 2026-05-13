import path from 'node:path'
import fs from 'node:fs/promises'
import { readdir, rename as fsRename } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { prisma, EpisodeStatus } from '@mediadillo/db'
import { previewEpisodeRenames, previewEpisodeFileRenames, applyEpisodeRenames, deleteToTrash, type RenamePreviewItem } from '../files/rename.js'
import { logActivity } from '../activity/log.js'
import { detectStaleFiles } from '../scanner/stale-detector.js'
import { runSeasonScan, runShowScan, isScanRunning } from '../scanner/index.js'
import { canonicalEpisodeFileName, canonicalMovieFolderName } from '../files/naming.js'
import { TmdbClient } from '../metadata/tmdb-client.js'
import { TvdbClient } from '../metadata/tvdb-client.js'
import { syncSeasonTitles } from '../metadata/enricher.js'
import { getApiConfig } from '../api-config.js'
import { triggerLibraryRefresh } from '../jellyfin/sync.js'
import { moveFile } from '../files/move.js'

// Derive the show folder from a set of known episode file paths, bounded by TV scan roots.
// Using path.dirname twice assumes showFolder/seasonFolder/file structure and goes too high
// for flat shows (showFolder/file), landing on the scan root and threatening the whole library.
// This helper always returns a direct child of a known TV scan root.
async function deriveShowFolder(filePaths: string[]): Promise<string | null> {
  if (filePaths.length === 0) return null
  const tvRoots = await prisma.scanRoot.findMany({ where: { type: 'tv' }, select: { path: true } })
  const firstPath = ([...filePaths].sort())[0]!
  for (const root of tvRoots) {
    const rootPrefix = root.path.endsWith('/') ? root.path : root.path + '/'
    if (firstPath.startsWith(rootPrefix)) {
      const showFolderName = firstPath.slice(rootPrefix.length).split('/')[0]
      if (!showFolderName) continue
      return path.join(root.path, showFolderName)
    }
  }
  // No scan root matched — refuse to derive a folder by guessing dirname levels.
  // Returning null causes callers to abort safely rather than operating on an unknown path.
  return null
}

export async function showsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/shows?search=&qualityTier=&missingArtwork=&unmatched=&duplicates=only|hide&organized=false&scanRootId=&status=continuing|ended&tmdbId=
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
      tmdbId?: string
    }
  }>('/shows', async (req, reply) => {
    const { search, qualityTier, missingArtwork, unmatched, duplicates, organized, addedSince, scanRootId, status, tmdbId: tmdbIdFilter } = req.query

    // Always compute dup groups with count (dismissed shows excluded — they don't inflate counts)
    const dupGroups = await prisma.tvShow.groupBy({
      by: ['tmdbId'],
      where: { tmdbId: { not: null }, dismissedAsDuplicate: false },
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
        ...(tmdbIdFilter ? { tmdbId: parseInt(tmdbIdFilter) } : {}),
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
        dismissedAsDuplicate: true,
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

    // Representative file per show — first owned episode file, for codec display
    const repFiles = await Promise.all(
      filteredIds.map((id) =>
        prisma.episodeFile.findFirst({
          where: { episode: { status: 'owned', season: { showId: id } } },
          select: { videoQualityTier: true, videoCodec: true, audioQualityTier: true, audioChannels: true, audioCodec: true },
          orderBy: [{ episode: { season: { seasonNumber: 'asc' } } }, { episode: { episodeNumber: 'asc' } }],
        }),
      ),
    )
    const repFileMap = new Map(filteredIds.map((id, i) => [id, repFiles[i] ?? null]))

    const dupSet = new Set(dupTmdbIds)
    const tagged = filtered.map(({ seasons, ...rest }) => ({
      ...rest,
      isDuplicate: rest.tmdbId != null && dupSet.has(rest.tmdbId),
      duplicateCount: rest.tmdbId != null ? (dupCountMap.get(rest.tmdbId) ?? 1) : 1,
      isOrganized: isShowOrganized({ seasons, ...rest }),
      scanRoots: showScanRoots.get(rest.id) ?? [],
      repFile: repFileMap.get(rest.id) ?? null,
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

    // Flatten seasons to include ownedCount; drop ghost seasons (no target episodes, none owned)
    const seasons = show.seasons
      .map((s) => ({
        id: s.id,
        seasonNumber: s.seasonNumber,
        episodeCount: s.episodeCount,
        ownedCount: s._count.episodes,
      }))
      .filter((s) => s.episodeCount > 0 || s.ownedCount > 0)

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

    // Duplicate detection for this show's tmdbId (dismissed shows don't count against others)
    const dupCount = show.tmdbId
      ? await prisma.tvShow.count({ where: { tmdbId: show.tmdbId, dismissedAsDuplicate: false } })
      : 1

    // Derive the show folder from episode file paths
    const firstFile = await prisma.episodeFile.findFirst({
      where: { episode: { season: { showId: show.id } } },
      select: { path: true },
      orderBy: [{ episode: { season: { seasonNumber: 'asc' } } }, { episode: { episodeNumber: 'asc' } }],
    })
    const showFolder = firstFile ? await deriveShowFolder([firstFile.path]) : null

    return reply.send({
      ...show,
      seasons,
      scanRoots: showScanRoots,
      isDuplicate: dupCount > 1,
      duplicateCount: dupCount,
      isOrganized: false,
      showFolder,
    })
  })

  // POST /api/shows/:id/consolidate — move sibling's episode files into this show's folder
  app.post<{ Params: { id: string }; Body: { siblingId: string } }>(
    '/shows/:id/consolidate',
    async (req, reply) => {
      const { siblingId } = req.body
      if (!siblingId) return reply.code(400).send({ error: 'siblingId is required' })

      const [target, source] = await Promise.all([
        prisma.tvShow.findUnique({ where: { id: req.params.id }, select: { id: true, title: true, year: true } }),
        prisma.tvShow.findUnique({ where: { id: siblingId }, select: { id: true } }),
      ])
      if (!target) return reply.code(404).send({ error: 'Show not found' })
      if (!source) return reply.code(404).send({ error: 'Sibling not found' })

      const sourceFiles = await prisma.episodeFile.findMany({
        where: { episode: { season: { showId: siblingId } } },
        select: { id: true, path: true },
      })
      if (sourceFiles.length === 0) return reply.code(422).send({ error: 'Sibling has no files to consolidate' })

      // Derive target show folder
      const targetFilePaths = await prisma.episodeFile.findMany({
        where: { episode: { season: { showId: req.params.id } } },
        select: { path: true },
      })
      let targetFolder = targetFilePaths.length > 0
        ? await deriveShowFolder(targetFilePaths.map((f) => f.path))
        : null

      if (!targetFolder) {
        // Target has no files — use canonical folder name under the source show's scan root
        const tvRoots = await prisma.scanRoot.findMany({ where: { type: 'tv' }, select: { path: true } })
        for (const root of tvRoots) {
          const rootPrefix = root.path.endsWith('/') ? root.path : root.path + '/'
          if (sourceFiles[0]?.path.startsWith(rootPrefix)) {
            targetFolder = path.join(root.path, canonicalMovieFolderName(target.title, target.year))
            break
          }
        }
      }
      if (!targetFolder) {
        return reply.code(422).send({ error: 'Cannot determine destination folder' })
      }

      // Derive source show folder for computing relative paths
      const sourceFolder = await deriveShowFolder(sourceFiles.map((f) => f.path))

      // Pre-check for conflicts
      for (const f of sourceFiles) {
        const rel = sourceFolder ? f.path.slice(sourceFolder.length + 1) : path.basename(f.path)
        const newPath = path.join(targetFolder, rel)
        if (newPath === f.path) continue
        const conflict = await prisma.episodeFile.findUnique({ where: { path: newPath } })
        if (conflict) {
          return reply.code(409).send({ error: `File conflict: ${rel} already exists in the target folder` })
        }
      }

      // Move files
      let consolidated = 0
      for (const f of sourceFiles) {
        const rel = sourceFolder ? f.path.slice(sourceFolder.length + 1) : path.basename(f.path)
        const newPath = path.join(targetFolder, rel)
        if (newPath === f.path) {
          consolidated++
          continue
        }
        await fs.mkdir(path.dirname(newPath), { recursive: true })
        await moveFile(f.path, newPath)
        await prisma.episodeFile.update({ where: { id: f.id }, data: { path: newPath } })
        consolidated++
      }

      // Clean up empty sibling season folders, then the show folder
      if (sourceFolder) {
        try {
          const seasonDirs = await fs.readdir(sourceFolder).catch(() => [] as string[])
          for (const dir of seasonDirs) {
            const full = path.join(sourceFolder, dir)
            const rem = await fs.readdir(full).catch(() => ['x'])
            if (rem.length === 0) await fs.rmdir(full).catch(() => {})
          }
          const rem = await fs.readdir(sourceFolder).catch(() => ['x'])
          if (rem.length === 0) await fs.rmdir(sourceFolder).catch(() => {})
        } catch { /* skip */ }
      }

      await prisma.tvShow.delete({ where: { id: siblingId } })
      triggerLibraryRefresh(app.log).catch(() => {})
      return reply.send({ consolidated })
    },
  )

  // POST /api/shows/:id/dismiss — mark as intentional duplicate
  app.post<{ Params: { id: string } }>('/shows/:id/dismiss', async (req, reply) => {
    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })
    await prisma.tvShow.update({ where: { id: req.params.id }, data: { dismissedAsDuplicate: true } })
    return reply.code(204).send()
  })

  // POST /api/shows/:id/undismiss — restore duplicate warning
  app.post<{ Params: { id: string } }>('/shows/:id/undismiss', async (req, reply) => {
    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })
    await prisma.tvShow.update({ where: { id: req.params.id }, data: { dismissedAsDuplicate: false } })
    return reply.code(204).send()
  })

  // DELETE /api/shows/:id/with-files — permanently delete all episode files + DB record
  app.delete<{ Params: { id: string } }>('/shows/:id/with-files', async (req, reply) => {
    const allFiles = await prisma.episodeFile.findMany({
      where: { episode: { season: { showId: req.params.id } } },
      select: { path: true },
    })
    if (allFiles.length === 0) {
      return reply.code(422).send({ error: 'Show has no files — use DELETE /shows/:id to remove the stale record' })
    }

    const showFolder = await deriveShowFolder(allFiles.map((f) => f.path))

    let deleted = 0
    for (const f of allFiles) {
      try { await fs.unlink(f.path); deleted++ } catch { /* skip */ }
    }

    // Remove empty season folders, then show folder
    if (showFolder) {
      try {
        const seasonDirs = await fs.readdir(showFolder).catch(() => [] as string[])
        for (const dir of seasonDirs) {
          const full = path.join(showFolder, dir)
          const rem = await fs.readdir(full).catch(() => ['x'])
          if (rem.length === 0) await fs.rmdir(full).catch(() => {})
        }
        const rem = await fs.readdir(showFolder).catch(() => ['x'])
        if (rem.length === 0) await fs.rmdir(showFolder).catch(() => {})
      } catch { /* skip */ }
    }

    await prisma.tvShow.delete({ where: { id: req.params.id } })
    triggerLibraryRefresh(app.log).catch(() => {})
    return reply.send({ deleted, showFolder: showFolder ?? null })
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

    const allFilePaths = show.seasons.flatMap((s) => s.episodes.flatMap((e) => e.files.map((f) => f.path)))
    const showFolder = await deriveShowFolder(allFilePaths)
    if (!showFolder) return reply.send({ renames: [], removals: [] })

    // Collect all DB-known video paths for this show
    const knownPaths = new Set(
      show.seasons.flatMap((s) => s.episodes.flatMap((e) => e.files.map((f) => f.path))),
    )

    // Walk show folder for stale detection
    const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.flv', '.ts', '.mpg', '.mpeg', '.m2ts', '.vob', '.iso'])
    async function dirHasVideoFiles(dir: string): Promise<boolean> {
      let entries: string[]
      try { entries = await readdir(dir) } catch { return false }
      for (const entry of entries) {
        if (entry.startsWith('.')) continue
        const full = path.join(dir, entry)
        if (VIDEO_EXTS.has(path.extname(entry).toLowerCase())) return true
        if (!path.extname(entry) && await dirHasVideoFiles(full)) return true
      }
      return false
    }
    const removals: Array<{ path: string; reason: string }> = []
    async function walkForStale(dir: string) {
      let entries: string[]
      try { entries = await readdir(dir) } catch { return }
      const staleInDir = await detectStaleFiles(dir, knownPaths)
      removals.push(...staleInDir)
      for (const entry of entries) {
        if (entry.startsWith('.')) continue  // skip .trash, .DS_Store, hidden dirs
        const full = path.join(dir, entry)
        if (!path.extname(entry)) {
          // Only flag a subfolder as orphaned if it contains zero video files on disk.
          // This is a filesystem check (not DB), so sibling show folders with real
          // videos are never accidentally flagged even if showFolder is computed wrong.
          if (!await dirHasVideoFiles(full)) {
            removals.push({ path: full, reason: 'orphaned folder — no video files' })
          } else {
            await walkForStale(full)
          }
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
        await logActivity({ action: 'cleanup', showId: req.params.id, filePath })
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

    const allFilePaths2 = show.seasons.flatMap((s) => s.episodes.flatMap((e) => e.files.map((f) => f.path)))
    if (allFilePaths2.length === 0) return reply.send({ trashed: 0, errors: [] })
    const showFolder = await deriveShowFolder(allFilePaths2)
    if (!showFolder) return reply.send({ trashed: 0, errors: [] })
    const knownPaths = new Set(allFilePaths2)

    // Identical video-file check used by the organize preview to decide whether a
    // subfolder is orphaned (no videos) vs. a live season folder (has videos).
    const VIDEO_EXTS_CLEANUP = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.flv', '.ts', '.mpg', '.mpeg', '.m2ts', '.vob', '.iso'])
    async function dirHasVideoFilesCleanup(dir: string): Promise<boolean> {
      let entries: string[]
      try { entries = await readdir(dir) } catch { return false }
      for (const entry of entries) {
        if (entry.startsWith('.')) continue
        const full = path.join(dir, entry)
        if (VIDEO_EXTS_CLEANUP.has(path.extname(entry).toLowerCase())) return true
        if (!path.extname(entry) && await dirHasVideoFilesCleanup(full)) return true
      }
      return false
    }

    const stalePaths: string[] = []
    async function walkForStale(dir: string) {
      let entries: string[]
      try { entries = await readdir(dir) } catch { return }
      const staleInDir = await detectStaleFiles(dir, knownPaths)
      stalePaths.push(...staleInDir.map((s) => s.path))
      for (const entry of entries) {
        if (entry.startsWith('.')) continue  // skip .trash, .DS_Store, hidden dirs
        const full = path.join(dir, entry)
        if (!path.extname(entry)) {
          // Only flag a subfolder as orphaned if it contains zero video files on disk.
          // Subfolders with videos are season/special folders — recurse into them instead.
          if (!await dirHasVideoFilesCleanup(full)) {
            stalePaths.push(full)
          } else {
            await walkForStale(full)
          }
        }
      }
    }
    await walkForStale(showFolder)

    let trashed = 0
    const errors: string[] = []
    for (const p of stalePaths) {
      try {
        await deleteToTrash(p)
        await logActivity({ action: 'cleanup', showId: req.params.id, filePath: p })
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
          const tvdbClient = cfg.tvdbApiKey ? new TvdbClient(cfg.tvdbApiKey, cfg.metadataLanguage) : null
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
        await logActivity({
          action: 'episode_assign',
          showId: req.params.id,
          episodeId: target.id,
          filePath: finalPath,
          detail: { reason: 'reorder' },
        })
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
          await logActivity({
            action: 'episode_assign',
            showId: req.params.id,
            episodeId: target.id,
            filePath: finalPath,
            detail: { reason: 'cross_reassign' },
          })
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

  // POST /shows/:id/assign-files — set which file covers which episode(s).
  // Same fileId on multiple consecutive episodes within a season → multi-episode file (multiEpisodeEnd set).
  app.post<{
    Params: { id: string }
    Body: { assignments: { episodeId: string; fileId: string | null }[] }
  }>('/shows/:id/assign-files', async (req, reply) => {
    const { assignments } = req.body
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return reply.code(400).send({ error: 'assignments must be a non-empty array' })
    }

    const show = await prisma.tvShow.findUnique({ where: { id: req.params.id }, select: { title: true } })
    if (!show) return reply.code(404).send({ error: 'Show not found' })

    const episodeIds = [...new Set(assignments.map((a) => a.episodeId))]
    const fileIds = [...new Set(assignments.flatMap((a) => (a.fileId ? [a.fileId] : [])))]

    const [episodes, files] = await Promise.all([
      prisma.episode.findMany({
        where: { id: { in: episodeIds }, season: { showId: req.params.id } },
        include: { season: { select: { id: true, seasonNumber: true } } },
      }),
      fileIds.length > 0 ? prisma.episodeFile.findMany({ where: { id: { in: fileIds } } }) : Promise.resolve([]),
    ])

    if (episodes.length !== episodeIds.length) {
      return reply.code(400).send({ error: 'Some episode IDs are invalid or belong to a different show' })
    }
    if (files.length !== fileIds.length) {
      return reply.code(400).send({ error: 'Some file IDs are invalid' })
    }

    const epMap = new Map(episodes.map((e) => [e.id, e]))
    const fileMap = new Map(files.map((f) => [f.id, f]))

    // Group: fileId → sorted list of episodes
    const byFile = new Map<string, Array<typeof episodes[0]>>()
    for (const { episodeId, fileId } of assignments) {
      if (!fileId) continue
      const ep = epMap.get(episodeId)
      if (!ep) continue
      const group = byFile.get(fileId) ?? []
      group.push(ep)
      byFile.set(fileId, group)
    }
    for (const group of byFile.values()) {
      group.sort((a, b) => a.season.seasonNumber - b.season.seasonNumber || a.episodeNumber - b.episodeNumber)
    }

    const errors: string[] = []
    let renamed = 0

    for (const [fileId, eps] of byFile) {
      const primaryEp = eps[0]!
      const lastEp = eps[eps.length - 1]!
      const file = fileMap.get(fileId)!

      // Multi-episode only when all assigned episodes are in the same season
      const allSameSeason = eps.every((e) => e.season.seasonNumber === primaryEp.season.seasonNumber)
      const multiEpisodeEnd = allSameSeason && eps.length > 1 ? lastEp.episodeNumber : null

      const ext = path.extname(file.path)
      const dir = path.dirname(file.path)
      const newName = canonicalEpisodeFileName(
        show.title,
        primaryEp.season.seasonNumber,
        primaryEp.episodeNumber,
        primaryEp.title,
        ext,
        multiEpisodeEnd,
        null,
      )
      const newPath = path.join(dir, newName)
      try {
        if (file.path !== newPath) {
          await fsRename(file.path, newPath)
          renamed++
        }
        await prisma.episodeFile.update({
          where: { id: fileId },
          data: { episodeId: primaryEp.id, path: newPath, multiEpisodeEnd },
        })
      } catch (err) {
        errors.push(`Failed for ${path.basename(file.path)}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Full status recalculation for all affected seasons
    const affectedSeasonIds = [...new Set(episodes.map((e) => e.season.id))]
    const today = new Date()
    for (const seasonId of affectedSeasonIds) {
      // Collect episode numbers covered as secondary via multiEpisodeEnd
      const primaries = await prisma.episodeFile.findMany({
        where: { episode: { seasonId } },
        select: { multiEpisodeEnd: true, episode: { select: { episodeNumber: true } } },
      })
      const ownedByMulti = new Set<number>()
      for (const pf of primaries) {
        if (pf.multiEpisodeEnd) {
          for (let n = pf.episode.episodeNumber + 1; n <= pf.multiEpisodeEnd; n++) ownedByMulti.add(n)
        }
      }

      const seasonEps = await prisma.episode.findMany({
        where: { seasonId },
        include: { files: true },
      })
      for (const ep of seasonEps) {
        let status: EpisodeStatus
        if (ep.files.length > 0) {
          status = EpisodeStatus.owned
        } else if (ownedByMulti.has(ep.episodeNumber)) {
          status = EpisodeStatus.owned
        } else if (ep.airDate && new Date(ep.airDate) > today) {
          status = EpisodeStatus.not_yet_aired
        } else {
          status = EpisodeStatus.missing
        }
        if (ep.status !== status) {
          await prisma.episode.update({ where: { id: ep.id }, data: { status } })
        }
      }
    }

    // Recalculate show totals
    const ownedCount = await prisma.episode.count({ where: { season: { showId: req.params.id }, status: 'owned' } })
    await prisma.tvShow.update({ where: { id: req.params.id }, data: { ownedEpisodes: ownedCount } })

    triggerLibraryRefresh(app.log).catch(() => {})
    return reply.send({ renamed, errors })
  })

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

      // Strip stale out-of-bounds episodes that have no file (phantom DB records beyond TVDB count)
      const episodes = season.episodes.filter(
        (ep) => ep.episodeNumber <= season.episodeCount || ep.status === 'owned',
      )

      return reply.send({ ...season, episodes })
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

      const allShowFiles = await prisma.episodeFile.findMany({
        where: { episode: { season: { showId: show.id } } },
        select: { path: true },
      })
      if (allShowFiles.length === 0) return reply.code(422).send({ error: 'Show has no files to move' })
      const showFolder = await deriveShowFolder(allShowFiles.map((f) => f.path))
      if (!showFolder) return reply.code(422).send({ error: 'Could not determine show folder' })
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

      await logActivity({
        action: 'collection_move',
        showId: show.id,
        fromPath: showFolder,
        toPath: newShowFolder,
        detail: { targetScanRootId: req.body.targetScanRootId },
      })

      return reply.send({ moved: true, newFolder: newShowFolder })
    },
  )
}

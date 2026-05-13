import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { runMovieFolderScan, isScanRunning } from '../scanner/index.js'
import { triggerLibraryRefresh } from '../jellyfin/sync.js'
import { canonicalMovieFolderName, canonicalMovieFileName } from '../files/naming.js'
import { applyMovieRenames, deleteToTrash } from '../files/rename.js'
import { scanMovieFolder } from '../files/cleanup.js'
import { moveFile } from '../files/move.js'
import { logActivity } from '../activity/log.js'

type QualityTier = 'SD' | '720p' | '1080p' | '4K'

export async function moviesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/movies?scanRootId=&genre=&qualityTier=&missingArtwork=&unmatched=&search=&duplicates=only|hide&missingFile=true&needsRename=true&organized=false&edition=
  app.get<{
    Querystring: {
      scanRootId?: string
      genre?: string
      qualityTier?: QualityTier
      missingArtwork?: string
      unmatched?: string
      search?: string
      duplicates?: string
      missingFile?: string
      needsRename?: string
      organized?: string
      edition?: string
      tmdbId?: string
      addedSince?: string
    }
  }>('/movies', async (req, reply) => {
    const { scanRootId, genre, qualityTier, missingArtwork, unmatched, search, duplicates, missingFile, needsRename, organized, edition, tmdbId, addedSince } = req.query

    // Always compute dup groups with count (needed for filter + duplicateCount badge).
    // Dismissed movies are excluded — they don't count as duplicates for others.
    const dupGroups = await prisma.movie.groupBy({
      by: ['tmdbId'],
      where: { tmdbId: { not: null }, dismissedAsDuplicate: false },
      having: { tmdbId: { _count: { gt: 1 } } },
      _count: { tmdbId: true },
    })
    const dupCountMap = new Map<number, number>(
      dupGroups.map((g) => [g.tmdbId as number, g._count.tmdbId]),
    )
    const dupTmdbIds = [...dupCountMap.keys()]

    // Shared filter conditions
    const sharedWhere = {
      OR: [
        { scanRootId: null },
        { scanRoot: { type: 'movies' as const } },
      ],
      ...(scanRootId ? { scanRootId } : {}),
      ...(genre ? { genres: { has: genre } } : {}),
      ...(qualityTier ? { files: { some: { videoQualityTier: qualityTier } } } : {}),
      ...(unmatched === 'true' ? { tmdbId: null } : {}),
      ...(missingFile === 'true' ? { files: { none: {} } } : {}),
      ...(duplicates === 'only' && dupTmdbIds.length > 0 ? { tmdbId: { in: dupTmdbIds } } : {}),
      ...(duplicates === 'hide' && dupTmdbIds.length > 0 ? { NOT: { tmdbId: { in: dupTmdbIds } } } : {}),
      ...(search ? { title: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(edition ? { files: { some: { edition } } } : {}),
      ...(tmdbId ? { tmdbId: parseInt(tmdbId) } : {}),
      ...(addedSince ? { createdAt: { gte: new Date(addedSince) } } : {}),
    }

    const andClauses = missingArtwork === 'true'
      ? [sharedWhere, { OR: [{ posterDownloaded: false }, { backdropDownloaded: false }] }]
      : [sharedWhere]

    const movies = await prisma.movie.findMany({
      where: { AND: andClauses },
      select: {
        id: true,
        title: true,
        year: true,
        posterUrl: true,
        genres: true,
        rating: true,
        runtime: true,
        tmdbId: true,
        posterDownloaded: true,
        backdropDownloaded: true,
        dismissedAsDuplicate: true,
        status: true,
        createdAt: true,
        scanRoot: { select: { id: true, label: true, path: true } },
        files: {
          select: { path: true, edition: true, threeD: true, sortOrder: true, videoQualityTier: true, videoCodec: true, audioQualityTier: true, audioChannels: true, audioCodec: true },
          orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }],
        },
      },
      orderBy: { title: 'asc' },
    })

    function allFilesCanonical(movie: typeof movies[0]): boolean {
      if (!movie.scanRoot || movie.files.length === 0) return false
      const folderPath = path.join(movie.scanRoot.path, canonicalMovieFolderName(movie.title, movie.year))

      // Mirror the rename logic: part numbers only within edition groups with >1 file
      const editionGroupSize = new Map<string | null, number>()
      for (const f of movie.files) {
        const key = f.edition ?? null
        editionGroupSize.set(key, (editionGroupSize.get(key) ?? 0) + 1)
      }
      const editionGroupIndex = new Map<string | null, number>()

      return movie.files.every((file) => {
        const key = file.edition ?? null
        const groupIdx = editionGroupIndex.get(key) ?? 0
        editionGroupIndex.set(key, groupIdx + 1)
        const partNumber = (editionGroupSize.get(key) ?? 1) > 1 ? groupIdx + 1 : null
        const proposed = path.join(
          folderPath,
          canonicalMovieFileName(movie.title, movie.year, path.extname(file.path), partNumber, file.edition ?? null, file.threeD ?? null),
        )
        return file.path === proposed
      })
    }

    function isOrganized(movie: typeof movies[0]): boolean {
      return movie.tmdbId != null && allFilesCanonical(movie)
    }

    let filtered = movies

    if (needsRename === 'true') {
      filtered = filtered.filter((movie) =>
        movie.scanRoot != null && movie.files.length > 0 && !allFilesCanonical(movie),
      )
    }

    if (organized === 'false') {
      filtered = filtered.filter((movie) => !isOrganized(movie))
    }

    const tagged = filtered.map(({ scanRoot, files, ...rest }) => ({
      ...rest,
      isDuplicate: rest.tmdbId != null && !rest.dismissedAsDuplicate && dupCountMap.has(rest.tmdbId),
      duplicateCount: rest.tmdbId != null ? (dupCountMap.get(rest.tmdbId) ?? 1) : 1,
      isOrganized: isOrganized({ scanRoot, files, ...rest }),
      fileCount: files.length,
      scanRoot: scanRoot ? { id: scanRoot.id, label: scanRoot.label } : null,
      files: files.slice(0, 1).map((f) => ({ path: f.path, edition: f.edition, videoQualityTier: f.videoQualityTier, videoCodec: f.videoCodec, audioQualityTier: f.audioQualityTier, audioChannels: f.audioChannels, audioCodec: f.audioCodec })),
    }))

    return reply.send(tagged)
  })

  // POST /api/movies/cleanup-tv-contamination — delete Movie records that belong to TV-type scan roots
  // These were created before the scanner was fixed to route files by root type.
  app.post('/movies/cleanup-tv-contamination', async (_req, reply) => {
    const tvRoots = await prisma.scanRoot.findMany({ where: { type: 'tv' } })
    if (tvRoots.length === 0) return reply.send({ deleted: 0 })
    const tvRootIds = tvRoots.map((r) => r.id)

    const contaminated = await prisma.movie.findMany({
      where: { scanRootId: { in: tvRootIds } },
      select: { id: true, title: true },
    })
    const ids = contaminated.map((m) => m.id)
    if (ids.length === 0) return reply.send({ deleted: 0 })

    await prisma.movieFile.deleteMany({ where: { movieId: { in: ids } } })
    await prisma.movie.deleteMany({ where: { id: { in: ids } } })

    for (const m of contaminated) {
      await logActivity({ action: 'item_removed', movieId: m.id, detail: { title: m.title, reason: 'tv_contamination' } })
    }

    return reply.send({ deleted: ids.length })
  })

  // DELETE /api/movies/:id — remove a stale record with no files
  app.delete<{ Params: { id: string } }>('/movies/:id', async (req, reply) => {
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id }, select: { id: true, title: true } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })
    await prisma.movie.delete({ where: { id: req.params.id } })
    await logActivity({ action: 'item_removed', movieId: movie.id, detail: { title: movie.title } })
    return reply.code(204).send()
  })

  // GET /api/movies/:id — full detail with files + credits
  app.get<{ Params: { id: string } }>('/movies/:id', async (req, reply) => {
    const movie = await prisma.movie.findUnique({
      where: { id: req.params.id },
      include: {
        scanRoot: true,
        files: { orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }] },
        credits: {
          include: { person: true },
          orderBy: { role: 'asc' },
        },
      },
    })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })
    return reply.send(movie)
  })

  // POST /api/movies/:id/rescan — re-scan the movie's folder
  app.post<{ Params: { id: string } }>('/movies/:id/rescan', async (req, reply) => {
    if (isScanRunning()) return reply.code(409).send({ error: 'A full scan is already running' })
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })
    try {
      const counts = await runMovieFolderScan(req.params.id)
      return reply.send(counts)
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Rescan failed' })
    }
  })

  // PATCH /api/movies/:id/files/order — set file sort order
  app.patch<{ Params: { id: string }; Body: { fileIds: string[] } }>(
    '/movies/:id/files/order',
    async (req, reply) => {
      const { fileIds } = req.body
      if (!Array.isArray(fileIds)) return reply.code(400).send({ error: 'fileIds must be an array' })

      await Promise.all(
        fileIds.map((id, idx) =>
          prisma.movieFile.update({ where: { id }, data: { sortOrder: idx } }),
        ),
      )
      return reply.send({ updated: fileIds.length })
    },
  )

  // PATCH /api/movies/files/:fileId/edition — set or clear edition label, then rename the file
  app.patch<{ Params: { fileId: string }; Body: { edition: string | null } }>(
    '/movies/files/:fileId/edition',
    async (req, reply) => {
      const { edition } = req.body
      const file = await prisma.movieFile.update({
        where: { id: req.params.fileId },
        data: { edition: edition ?? null },
      })
      // Rename the physical file so the {edition-...} token stays in sync with the DB value
      await applyMovieRenames([file.id])
      const updated = await prisma.movieFile.findUnique({ where: { id: file.id } })
      return reply.send({ id: file.id, edition: file.edition, path: updated?.path })
    },
  )

  // PATCH /api/movies/files/:fileId/threeD — set or clear 3D format, then rename the file
  app.patch<{ Params: { fileId: string }; Body: { threeD: string | null } }>(
    '/movies/files/:fileId/threeD',
    async (req, reply) => {
      const { threeD } = req.body
      const validValues = ['sbs', 'ou', 'full_sbs', 'unknown', null]
      if (!validValues.includes(threeD)) return reply.code(400).send({ error: 'Invalid threeD value' })
      const file = await prisma.movieFile.update({
        where: { id: req.params.fileId },
        data: { threeD: (threeD as 'sbs' | 'ou' | 'full_sbs' | 'unknown' | null) ?? null },
      })
      await applyMovieRenames([file.id])
      const updated = await prisma.movieFile.findUnique({ where: { id: file.id } })
      return reply.send({ id: file.id, threeD: file.threeD, path: updated?.path })
    },
  )

  // GET /api/movies/editions — list all distinct edition labels in use
  app.get('/movies/editions', async (_req, reply) => {
    const rows = await prisma.movieFile.findMany({
      where: { edition: { not: null } },
      select: { edition: true },
      distinct: ['edition'],
      orderBy: { edition: 'asc' },
    })
    return reply.send({ editions: rows.map((r) => r.edition as string) })
  })

  // POST /api/movies/editions/rename — rename an edition label globally (updates all files + renames on disk)
  app.post<{ Body: { from: string; to: string | null } }>(
    '/movies/editions/rename',
    async (req, reply) => {
      const { from, to } = req.body
      if (!from) return reply.code(400).send({ error: 'from is required' })

      const files = await prisma.movieFile.findMany({
        where: { edition: from },
        select: { id: true },
      })
      if (files.length === 0) return reply.send({ updated: 0 })

      const fileIds = files.map((f) => f.id)
      await prisma.movieFile.updateMany({
        where: { edition: from },
        data: { edition: to ?? null },
      })
      await applyMovieRenames(fileIds)
      return reply.send({ updated: fileIds.length })
    },
  )

  // POST /api/movies/:id/move — move movie folder to a different scan root
  app.post<{ Params: { id: string }; Body: { targetScanRootId: string } }>(
    '/movies/:id/move',
    async (req, reply) => {
      const movie = await prisma.movie.findUnique({
        where: { id: req.params.id },
        include: { files: true, scanRoot: true },
      })
      if (!movie) return reply.code(404).send({ error: 'Movie not found' })
      if (!movie.files.length) return reply.code(422).send({ error: 'Movie has no files to move' })

      const targetRoot = await prisma.scanRoot.findUnique({ where: { id: req.body.targetScanRootId } })
      if (!targetRoot) return reply.code(404).send({ error: 'Target scan root not found' })
      if (targetRoot.type !== 'movies') return reply.code(422).send({ error: 'Target must be a movies-type scan root' })
      if (movie.scanRootId === targetRoot.id) return reply.code(422).send({ error: 'Already in this collection' })

      // Derive the movie folder from the first file
      const currentFolder = path.dirname(movie.files[0]!.path)
      const folderName = path.basename(currentFolder)
      const newFolder = path.join(targetRoot.path, folderName)

      if (currentFolder === newFolder) return reply.code(422).send({ error: 'Source and target are the same path' })

      try {
        await fs.rename(currentFolder, newFolder)
      } catch (err) {
        return reply.code(500).send({ error: `Failed to move folder: ${err instanceof Error ? err.message : String(err)}` })
      }

      // Update all file paths and the scan root reference
      await Promise.all([
        ...movie.files.map((f) =>
          prisma.movieFile.update({
            where: { id: f.id },
            data: { path: f.path.replace(currentFolder, newFolder) },
          }),
        ),
        prisma.movie.update({ where: { id: movie.id }, data: { scanRootId: targetRoot.id } }),
      ])

      await logActivity({
        action: 'collection_move',
        movieId: movie.id,
        fromPath: currentFolder,
        toPath: newFolder,
        detail: { targetScanRootId: req.body.targetScanRootId },
      })

      triggerLibraryRefresh(app.log).catch(() => {})
      return reply.send({ moved: true, newFolder })
    },
  )

  // GET /api/movies/:id/folder-scan — list folder contents with cleanup categories
  app.get<{ Params: { id: string } }>('/movies/:id/folder-scan', async (req, reply) => {
    const result = await scanMovieFolder(req.params.id)
    if (result === null) {
      const exists = await prisma.movie.findUnique({ where: { id: req.params.id }, select: { id: true } })
      return exists
        ? reply.code(422).send({ error: 'No files' })
        : reply.code(404).send({ error: 'Not found' })
    }
    return reply.send(result)
  })

  // DELETE /api/movies/:id/with-files — permanently delete all files in the movie folder + DB record
  app.delete<{ Params: { id: string } }>('/movies/:id/with-files', async (req, reply) => {
    const scanned = await scanMovieFolder(req.params.id)
    if (!scanned) {
      return reply.code(422).send({ error: 'Movie has no files — use DELETE /movies/:id to remove the stale record' })
    }

    // Delete every file in the folder
    let deleted = 0
    for (const f of scanned.files) {
      try {
        await fs.unlink(f.path)
        await logActivity({ action: 'item_removed', movieId: req.params.id, filePath: f.path })
        deleted++
      } catch { /* skip */ }
    }

    // Remove the folder itself if it is now empty
    try {
      const remaining = await fs.readdir(scanned.folderPath)
      if (remaining.length === 0) await fs.rmdir(scanned.folderPath)
    } catch { /* skip if folder not empty or already gone */ }

    // Remove DB record (cascade deletes MovieFile rows via schema)
    await prisma.movie.delete({ where: { id: req.params.id } })

    triggerLibraryRefresh(app.log).catch(() => {})
    return reply.send({ deleted, folderPath: scanned.folderPath })
  })

  // POST /api/movies/:id/cleanup — delete specified files (safety-checked to folder)
  app.post<{ Params: { id: string }; Body: { paths: string[] } }>(
    '/movies/:id/cleanup',
    async (req, reply) => {
      const movie = await prisma.movie.findUnique({
        where: { id: req.params.id },
        include: { files: { take: 1, orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }] }, scanRoot: true },
      })
      if (!movie) return reply.code(404).send({ error: 'Not found' })
      if (!movie.files.length) return reply.code(422).send({ error: 'No files' })

      // Derive the movie folder safely: it must be a direct child of the scan root.
      // If there is no scan root, or the file sits at root level, fall back to fileDir.
      const firstFile = movie.files[0]!
      const fileDir = path.dirname(firstFile.path)
      const scanRootPath = movie.scanRoot?.path
      let folderPath: string
      if (scanRootPath) {
        const rootPrefix = scanRootPath.endsWith('/') ? scanRootPath : scanRootPath + '/'
        if (fileDir.startsWith(rootPrefix)) {
          // folderPath = direct child of scan root containing this file
          const relative = fileDir.slice(rootPrefix.length)
          const topLevelDir = relative.split('/')[0]!
          folderPath = topLevelDir ? path.join(scanRootPath, topLevelDir) : fileDir
        } else {
          // File is not under its own scan root — refuse to operate
          return reply.code(422).send({ error: 'File is not inside its scan root — cannot determine safe folder' })
        }
      } else {
        folderPath = fileDir
      }

      // Only trash paths that are strictly inside the derived movie folder
      const safe = req.body.paths.filter((p) => p.startsWith(folderPath + '/') || p.startsWith(folderPath + path.sep))
      let deleted = 0
      const errors: string[] = []
      for (const p of safe) {
        try {
          await deleteToTrash(p)
          deleted++
        } catch (err) {
          errors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      return reply.send({ deleted, errors })
    },
  )

  // POST /api/movies/:id/consolidate — move sibling's files into current movie's folder
  app.post<{ Params: { id: string }; Body: { siblingId: string } }>(
    '/movies/:id/consolidate',
    async (req, reply) => {
      const { siblingId } = req.body
      if (!siblingId) return reply.code(400).send({ error: 'siblingId is required' })

      const [target, source] = await Promise.all([
        prisma.movie.findUnique({ where: { id: req.params.id }, include: { files: true, scanRoot: true } }),
        prisma.movie.findUnique({ where: { id: siblingId }, include: { files: true } }),
      ])
      if (!target) return reply.code(404).send({ error: 'Movie not found' })
      if (!source) return reply.code(404).send({ error: 'Sibling not found' })
      if (source.files.length === 0) return reply.code(422).send({ error: 'Sibling has no files to consolidate' })

      // Determine the target folder
      let targetFolder: string
      if (target.files.length > 0) {
        targetFolder = path.dirname(target.files[0]!.path)
      } else if (target.scanRoot) {
        targetFolder = path.join(target.scanRoot.path, canonicalMovieFolderName(target.title, target.year))
      } else {
        return reply.code(422).send({ error: 'Target movie has no files and no scan root — cannot determine destination folder' })
      }

      // Check for filename conflicts before moving anything
      for (const f of source.files) {
        const newPath = path.join(targetFolder, path.basename(f.path))
        if (newPath === f.path) continue
        const existing = await prisma.movieFile.findUnique({ where: { path: newPath } })
        if (existing) return reply.code(409).send({ error: `Filename conflict: ${path.basename(f.path)} already exists in the target folder` })
      }

      await fs.mkdir(targetFolder, { recursive: true })
      let consolidated = 0
      for (const f of source.files) {
        const newPath = path.join(targetFolder, path.basename(f.path))
        if (newPath === f.path) {
          // File is already in target folder — just re-parent the record
          await prisma.movieFile.update({ where: { id: f.id }, data: { movieId: target.id } })
        } else {
          await moveFile(f.path, newPath)
          await prisma.movieFile.update({ where: { id: f.id }, data: { path: newPath, movieId: target.id } })
        }
        consolidated++
      }

      // Clean up source folder if now empty
      const sourceFolder = path.dirname(source.files[0]!.path)
      try {
        const remaining = await fs.readdir(sourceFolder)
        if (remaining.length === 0) await fs.rmdir(sourceFolder)
      } catch { /* skip */ }

      await prisma.movie.delete({ where: { id: siblingId } })
      triggerLibraryRefresh(app.log).catch(() => {})
      return reply.send({ consolidated })
    },
  )

  // POST /api/movies/:id/replace — delete current files, move sibling's files in
  app.post<{ Params: { id: string }; Body: { siblingId: string } }>(
    '/movies/:id/replace',
    async (req, reply) => {
      const { siblingId } = req.body
      if (!siblingId) return reply.code(400).send({ error: 'siblingId is required' })

      const [target, source] = await Promise.all([
        prisma.movie.findUnique({ where: { id: req.params.id }, include: { files: true } }),
        prisma.movie.findUnique({ where: { id: siblingId }, include: { files: true } }),
      ])
      if (!target) return reply.code(404).send({ error: 'Movie not found' })
      if (!source) return reply.code(404).send({ error: 'Sibling not found' })
      if (target.files.length === 0) return reply.code(422).send({ error: 'Target movie has no files — use Consolidate instead' })
      if (source.files.length === 0) return reply.code(422).send({ error: 'Sibling has no files to replace with' })

      const targetFolder = path.dirname(target.files[0]!.path)

      // Delete current target files from disk
      for (const f of target.files) {
        try { await fs.unlink(f.path) } catch { /* skip if already gone */ }
      }
      await prisma.movieFile.deleteMany({ where: { movieId: target.id } })

      // Move source files into the target folder
      await fs.mkdir(targetFolder, { recursive: true })
      let replaced = 0
      for (const f of source.files) {
        const newPath = path.join(targetFolder, path.basename(f.path))
        await moveFile(f.path, newPath)
        await prisma.movieFile.update({ where: { id: f.id }, data: { path: newPath, movieId: target.id } })
        replaced++
      }

      // Clean up source folder if now empty
      const sourceFolder = path.dirname(source.files[0]!.path)
      try {
        const remaining = await fs.readdir(sourceFolder)
        if (remaining.length === 0) await fs.rmdir(sourceFolder)
      } catch { /* skip */ }

      await prisma.movie.delete({ where: { id: siblingId } })
      triggerLibraryRefresh(app.log).catch(() => {})
      return reply.send({ replaced })
    },
  )

  // POST /api/movies/:id/dismiss — mark as intentional duplicate (suppresses badge)
  app.post<{ Params: { id: string } }>('/movies/:id/dismiss', async (req, reply) => {
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })
    await prisma.movie.update({ where: { id: req.params.id }, data: { dismissedAsDuplicate: true } })
    return reply.code(204).send()
  })

  // POST /api/movies/:id/undismiss — restore duplicate warning
  app.post<{ Params: { id: string } }>('/movies/:id/undismiss', async (req, reply) => {
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })
    await prisma.movie.update({ where: { id: req.params.id }, data: { dismissedAsDuplicate: false } })
    return reply.code(204).send()
  })

  // DELETE /api/movies/files/:fileId/from-disk — delete one file from disk and remove its MovieFile record
  app.delete<{ Params: { fileId: string } }>('/movies/files/:fileId/from-disk', async (req, reply) => {
    const file = await prisma.movieFile.findUnique({
      where: { id: req.params.fileId },
      include: { movie: { include: { scanRoot: true } } },
    })
    if (!file) return reply.code(404).send({ error: 'File not found' })
    try { await fs.unlink(file.path) } catch { /* skip if already gone */ }
    await prisma.movieFile.delete({ where: { id: req.params.fileId } })

    // Remove parent folder if it is now empty (and is not the scan root itself)
    const dir = path.dirname(file.path)
    const scanRootPath = file.movie.scanRoot?.path
    if (scanRootPath && dir !== scanRootPath) {
      try {
        const remaining = await fs.readdir(dir)
        if (remaining.length === 0) await fs.rmdir(dir)
      } catch { /* skip */ }
    }

    triggerLibraryRefresh(app.log).catch(() => {})
    return reply.send({ deleted: 1, path: file.path })
  })
}

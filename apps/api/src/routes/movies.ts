import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'
import { runMovieFolderScan, isScanRunning } from '../scanner/index.js'
import { triggerLibraryRefresh } from '../jellyfin/sync.js'
import { canonicalMovieFolderName, canonicalMovieFileName } from '../files/naming.js'
import { applyMovieRenames } from '../files/rename.js'
import { scanMovieFolder } from '../files/cleanup.js'

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
    }
  }>('/movies', async (req, reply) => {
    const { scanRootId, genre, qualityTier, missingArtwork, unmatched, search, duplicates, missingFile, needsRename, organized, edition, tmdbId } = req.query

    // Always compute dup groups with count (needed for filter + duplicateCount badge)
    const dupGroups = await prisma.movie.groupBy({
      by: ['tmdbId'],
      where: { tmdbId: { not: null } },
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
        status: true,
        scanRoot: { select: { id: true, label: true, path: true } },
        files: {
          select: { path: true, edition: true, sortOrder: true, videoQualityTier: true, videoCodec: true, audioQualityTier: true, audioChannels: true, audioCodec: true },
          orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }],
        },
      },
      orderBy: { title: 'asc' },
    })

    function allFilesCanonical(movie: typeof movies[0]): boolean {
      if (!movie.scanRoot || movie.files.length === 0) return false
      const folderPath = path.join(movie.scanRoot.path, canonicalMovieFolderName(movie.title, movie.year))
      const isMulti = movie.files.length > 1
      return movie.files.every((file, idx) => {
        const proposed = path.join(
          folderPath,
          canonicalMovieFileName(movie.title, movie.year, path.extname(file.path), isMulti ? idx + 1 : null, file.edition ?? null),
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
      isDuplicate: rest.tmdbId != null && dupCountMap.has(rest.tmdbId),
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
      select: { id: true },
    })
    const ids = contaminated.map((m) => m.id)
    if (ids.length === 0) return reply.send({ deleted: 0 })

    await prisma.movieFile.deleteMany({ where: { movieId: { in: ids } } })
    await prisma.movie.deleteMany({ where: { id: { in: ids } } })

    return reply.send({ deleted: ids.length })
  })

  // DELETE /api/movies/:id — remove a stale record with no files
  app.delete<{ Params: { id: string } }>('/movies/:id', async (req, reply) => {
    const movie = await prisma.movie.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!movie) return reply.code(404).send({ error: 'Movie not found' })
    await prisma.movie.delete({ where: { id: req.params.id } })
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
      try { await fs.unlink(f.path); deleted++ } catch { /* skip */ }
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

      const firstFile = movie.files[0]!
      const fileDir = path.dirname(firstFile.path)
      const scanRootPath = movie.scanRoot?.path ?? ''
      const folderPath = scanRootPath && path.dirname(fileDir) !== scanRootPath
        ? path.dirname(fileDir)
        : fileDir

      const safe = req.body.paths.filter((p) => p.startsWith(folderPath + '/') || p.startsWith(folderPath + path.sep))
      let deleted = 0
      for (const p of safe) {
        try { await fs.unlink(p); deleted++ } catch { /* skip unreadable */ }
      }

      return reply.send({ deleted })
    },
  )

  // DELETE /api/movies/files/:fileId/from-disk — delete one file from disk and remove its MovieFile record
  app.delete<{ Params: { fileId: string } }>('/movies/files/:fileId/from-disk', async (req, reply) => {
    const file = await prisma.movieFile.findUnique({ where: { id: req.params.fileId } })
    if (!file) return reply.code(404).send({ error: 'File not found' })
    try { await fs.unlink(file.path) } catch { /* skip if already gone */ }
    await prisma.movieFile.delete({ where: { id: req.params.fileId } })
    triggerLibraryRefresh(app.log).catch(() => {})
    return reply.send({ deleted: 1, path: file.path })
  })
}

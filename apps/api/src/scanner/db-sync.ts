import path from 'node:path'
import { prisma, MediaType, CreditRole } from '@mediadillo/db'
import type { ScannedFile, VideoTechSpecs } from './types.js'
import type { WalkedFile } from './walker.js'
import type { StaleFileEntry } from './stale-detector.js'
import { detectLocalArtwork } from './artwork-detector.js'
import { parseMovieNfo, parseShowNfo, parseEpisodeNfo } from './nfo-parser.js'
import { parseMovieFolderName, parseFilename, detect3DFormat } from './filename-parser.js'
import { extractTechSpecs } from './ffprobe.js'
import { logActivity } from '../activity/log.js'

export interface ScanCounts {
  added: number
  changed: number
  removed: number
}

export async function syncMovieFile(
  file: ScannedFile,
  scanRootId: string,
  scanRootPath?: string,
): Promise<'added' | 'changed' | 'unchanged'> {
  if (file.parsed.type !== 'movie') throw new Error('Expected movie file')
  const { title, year, edition } = file.parsed
  const specs = file.techSpecs

  // For multi-disc movies where files live in cd1/cd2 subfolders, artwork and
  // NFO are in the movie root (one level below the scan root), not in the disc folder.
  const fileDir = path.dirname(file.path)
  const movieFolder = scanRootPath && path.dirname(fileDir) !== scanRootPath
    ? path.dirname(fileDir)
    : fileDir

  const [artwork, nfo] = await Promise.all([
    detectLocalArtwork(movieFolder),
    parseMovieNfo(movieFolder),
  ])

  // Find or create the Movie record.
  // Priority: (1) movie that already owns this file path — survives title changes
  // after TMDB enrichment; (2) title+year lookup for truly new files.
  const existingFileRef = await prisma.movieFile.findUnique({
    where: { path: file.path },
    select: { movieId: true },
  })
  let movie = existingFileRef
    ? await prisma.movie.findUnique({ where: { id: existingFileRef.movieId } })
    : null

  // Self-heal: if the file-path lookup found a stale record with a broken title
  // (pre-parser-fix disc suffix like "Movie - cd1") and it was never TMDB-matched,
  // try to re-parent it onto the canonical movie for this title+year.
  if (movie && !movie.tmdbId && movie.title !== (nfo?.title ?? title)) {
    const canonical = await prisma.movie.findFirst({
      where: { title: nfo?.title ?? title, year: year ?? null, scanRootId, id: { not: movie.id } },
    })
    if (canonical) {
      // Re-parent this file to the canonical record and clean up the stale one.
      await prisma.movieFile.updateMany({ where: { movieId: movie.id }, data: { movieId: canonical.id } })
      const remaining = await prisma.movieFile.count({ where: { movieId: movie.id } })
      if (remaining === 0) await prisma.movie.delete({ where: { id: movie.id } })
      movie = canonical
    } else {
      // No canonical yet — fix the stale record's title so the next disc file
      // can find it via title+year lookup instead of creating a duplicate.
      await prisma.movie.update({
        where: { id: movie.id },
        data: { title: nfo?.title ?? title, year: year ?? null },
      })
      movie = await prisma.movie.findUnique({ where: { id: movie.id } })
    }
  }

  if (!movie) {
    movie = await prisma.movie.findFirst({ where: { title, year: year ?? null, scanRootId } })
  }
  if (!movie) {
    movie = await prisma.movie.create({
      data: {
        title: nfo?.title ?? title,
        year: nfo?.year ?? year,
        status: 'owned',
        scanRootId,
        tmdbId: nfo?.tmdbId ?? null,
        imdbId: nfo?.imdbId ?? null,
        overview: nfo?.overview ?? null,
        tagline: nfo?.tagline ?? null,
        rating: nfo?.rating ?? null,
        runtime: nfo?.runtime ?? null,
        genres: nfo?.genres ?? [],
        posterDownloaded: artwork.hasPoster,
        backdropDownloaded: artwork.hasBackdrop,
      },
    })
  } else {
    // Update metadata from NFO if not yet matched to TMDB
    const updates: Record<string, unknown> = {}
    if (!movie.tmdbId && nfo?.tmdbId) updates['tmdbId'] = nfo.tmdbId
    if (!movie.imdbId && nfo?.imdbId) updates['imdbId'] = nfo.imdbId
    if (!movie.overview && nfo?.overview) updates['overview'] = nfo.overview
    if (!movie.tagline && nfo?.tagline) updates['tagline'] = nfo.tagline
    if (!movie.rating && nfo?.rating) updates['rating'] = nfo.rating
    if (!movie.runtime && nfo?.runtime) updates['runtime'] = nfo.runtime
    if ((!movie.genres || movie.genres.length === 0) && nfo?.genres?.length) updates['genres'] = nfo.genres
    if (artwork.hasPoster) updates['posterDownloaded'] = true
    if (artwork.hasBackdrop) updates['backdropDownloaded'] = true
    if (Object.keys(updates).length > 0) {
      await prisma.movie.update({ where: { id: movie.id }, data: updates })
    }
  }

  // Sync credits from NFO if movie has none yet
  if (nfo && (nfo.directors.length > 0 || nfo.cast.length > 0)) {
    const existingCredits = await prisma.credit.count({ where: { mediaType: MediaType.movie, movieId: movie.id } })
    if (existingCredits === 0) {
      const creditData: Array<{ mediaType: MediaType; movieId: string; role: CreditRole; character: string | null; personId: string }> = []
      for (const name of nfo.directors) {
        const person = await prisma.person.upsert({
          where: { tmdbId: -Math.abs(hashName(name)) },
          create: { tmdbId: -Math.abs(hashName(name)), name },
          update: {},
        })
        creditData.push({ mediaType: MediaType.movie, movieId: movie.id, role: CreditRole.director, character: null, personId: person.id })
      }
      for (const actor of nfo.cast.slice(0, 20)) {
        const person = await prisma.person.upsert({
          where: { tmdbId: -Math.abs(hashName(actor.name)) },
          create: { tmdbId: -Math.abs(hashName(actor.name)), name: actor.name },
          update: {},
        })
        creditData.push({ mediaType: MediaType.movie, movieId: movie.id, role: CreditRole.cast, character: actor.role, personId: person.id })
      }
      if (creditData.length > 0) {
        await prisma.credit.createMany({ data: creditData, skipDuplicates: true })
      }
    }
  }

  const existing = await prisma.movieFile.findUnique({ where: { path: file.path } })

  if (!existing) {
    await prisma.movieFile.create({
      data: {
        movieId: movie.id,
        path: file.path,
        sizeBytes: file.sizeBytes,
        edition,
        videoCodec: specs.videoCodec,
        videoResolution: specs.videoResolution,
        videoQualityTier: specs.videoQualityTier,
        hdr: specs.hdr,
        audioCodec: specs.audioCodec,
        audioChannels: specs.audioChannels,
        audioQualityTier: specs.audioQualityTier,
      },
    })
    await logActivity({ action: 'item_added', movieId: movie.id, filePath: file.path }).catch(() => {})
    return 'added'
  }

  const mtimeChanged = existing.scannedAt.getTime() < file.mtimeMs
  if (mtimeChanged || existing.videoCodec !== specs.videoCodec || existing.edition !== edition) {
    await prisma.movieFile.update({
      where: { path: file.path },
      data: {
        sizeBytes: file.sizeBytes,
        edition,
        videoCodec: specs.videoCodec,
        videoResolution: specs.videoResolution,
        videoQualityTier: specs.videoQualityTier,
        hdr: specs.hdr,
        audioCodec: specs.audioCodec,
        audioChannels: specs.audioChannels,
        audioQualityTier: specs.audioQualityTier,
        scannedAt: new Date(),
      },
    })
    return 'changed'
  }

  return 'unchanged'
}

// ---------------------------------------------------------------------------
// Folder-level movie sync — one folder = one movie
// ---------------------------------------------------------------------------

export async function syncMovieFolder(
  folderPath: string,
  files: WalkedFile[],
  scanRootId: string,
): Promise<ScanCounts> {
  const { title, year } = parseMovieFolderName(path.basename(folderPath))

  const [artwork, nfo] = await Promise.all([
    detectLocalArtwork(folderPath),
    parseMovieNfo(folderPath),
  ])

  // Find or create the Movie record.
  // Try: any existing MovieFile whose path starts with this folder → get movieId.
  // Fallback: title+year lookup for truly new folders.
  const existingFileRef = await prisma.movieFile.findFirst({
    where: { path: { startsWith: folderPath + '/' } },
    select: { movieId: true },
  })
  let movie = existingFileRef
    ? await prisma.movie.findUnique({ where: { id: existingFileRef.movieId } })
    : null
  if (!movie) {
    movie = await prisma.movie.findFirst({ where: { title: nfo?.title ?? title, year: year ?? null, scanRootId } })
  }
  if (!movie) {
    movie = await prisma.movie.create({
      data: {
        title: nfo?.title ?? title,
        year: nfo?.year ?? year,
        status: 'owned',
        scanRootId,
        tmdbId: nfo?.tmdbId ?? null,
        imdbId: nfo?.imdbId ?? null,
        overview: nfo?.overview ?? null,
        tagline: nfo?.tagline ?? null,
        rating: nfo?.rating ?? null,
        runtime: nfo?.runtime ?? null,
        genres: nfo?.genres ?? [],
        posterDownloaded: artwork.hasPoster,
        backdropDownloaded: artwork.hasBackdrop,
      },
    })
  } else {
    const updates: Record<string, unknown> = {}
    if (!movie.tmdbId && nfo?.tmdbId) updates['tmdbId'] = nfo.tmdbId
    if (!movie.imdbId && nfo?.imdbId) updates['imdbId'] = nfo.imdbId
    if (!movie.overview && nfo?.overview) updates['overview'] = nfo.overview
    if (!movie.tagline && nfo?.tagline) updates['tagline'] = nfo.tagline
    if (!movie.rating && nfo?.rating) updates['rating'] = nfo.rating
    if (!movie.runtime && nfo?.runtime) updates['runtime'] = nfo.runtime
    if ((!movie.genres || movie.genres.length === 0) && nfo?.genres?.length) updates['genres'] = nfo.genres
    if (artwork.hasPoster) updates['posterDownloaded'] = true
    if (artwork.hasBackdrop) updates['backdropDownloaded'] = true
    if (Object.keys(updates).length > 0) {
      await prisma.movie.update({ where: { id: movie.id }, data: updates })
    }
  }

  // Sync credits from NFO once per folder
  if (nfo && (nfo.directors.length > 0 || nfo.cast.length > 0)) {
    const existingCredits = await prisma.credit.count({ where: { mediaType: MediaType.movie, movieId: movie.id } })
    if (existingCredits === 0) {
      const creditData: Array<{ mediaType: MediaType; movieId: string; role: CreditRole; character: string | null; personId: string }> = []
      for (const name of nfo.directors) {
        const person = await prisma.person.upsert({
          where: { tmdbId: -Math.abs(hashName(name)) },
          create: { tmdbId: -Math.abs(hashName(name)), name },
          update: {},
        })
        creditData.push({ mediaType: MediaType.movie, movieId: movie.id, role: CreditRole.director, character: null, personId: person.id })
      }
      for (const actor of nfo.cast.slice(0, 20)) {
        const person = await prisma.person.upsert({
          where: { tmdbId: -Math.abs(hashName(actor.name)) },
          create: { tmdbId: -Math.abs(hashName(actor.name)), name: actor.name },
          update: {},
        })
        creditData.push({ mediaType: MediaType.movie, movieId: movie.id, role: CreditRole.cast, character: actor.role, personId: person.id })
      }
      if (creditData.length > 0) {
        await prisma.credit.createMany({ data: creditData, skipDuplicates: true })
      }
    }
  }

  // Upsert a MovieFile for each video file in this folder
  let added = 0; let changed = 0
  for (const walkedFile of files) {
    let specs: VideoTechSpecs
    try {
      specs = await extractTechSpecs(walkedFile.path)
    } catch {
      specs = { videoCodec: null, videoResolution: null, videoQualityTier: null, hdr: false, audioCodec: null, audioChannels: null, audioQualityTier: null }
    }

    const fileParsed = parseFilename(walkedFile.path)
    const fileEdition = fileParsed.type === 'movie' ? fileParsed.edition : null
    const fileThreeD = detect3DFormat(walkedFile.path)

    const existing = await prisma.movieFile.findUnique({ where: { path: walkedFile.path } })
    if (!existing) {
      await prisma.movieFile.create({
        data: {
          movieId: movie.id,
          path: walkedFile.path,
          sizeBytes: walkedFile.sizeBytes,
          edition: fileEdition,
          threeD: fileThreeD,
          videoCodec: specs.videoCodec,
          videoResolution: specs.videoResolution,
          videoQualityTier: specs.videoQualityTier,
          hdr: specs.hdr,
          audioCodec: specs.audioCodec,
          audioChannels: specs.audioChannels,
          audioQualityTier: specs.audioQualityTier,
        },
      })
      await logActivity({ action: 'item_added', movieId: movie.id, filePath: walkedFile.path }).catch(() => {})
      added++
    } else {
      const needsReparent = existing.movieId !== movie.id
      const needsUpdate = existing.scannedAt.getTime() < walkedFile.mtimeMs || existing.videoCodec !== specs.videoCodec || existing.edition !== fileEdition || existing.threeD !== fileThreeD
      if (needsReparent || needsUpdate) {
        const oldMovieId = needsReparent ? existing.movieId : null
        await prisma.movieFile.update({
          where: { path: walkedFile.path },
          data: {
            movieId: movie.id,
            sizeBytes: walkedFile.sizeBytes,
            edition: fileEdition,
            threeD: fileThreeD,
            videoCodec: specs.videoCodec,
            videoResolution: specs.videoResolution,
            videoQualityTier: specs.videoQualityTier,
            hdr: specs.hdr,
            audioCodec: specs.audioCodec,
            audioChannels: specs.audioChannels,
            audioQualityTier: specs.audioQualityTier,
            ...(needsUpdate ? { scannedAt: new Date() } : {}),
          },
        })
        changed++

        // Clean up the stale Movie record that no longer owns any files
        if (oldMovieId) {
          const remaining = await prisma.movieFile.count({ where: { movieId: oldMovieId } })
          if (remaining === 0) {
            const stale = await prisma.movie.findUnique({ where: { id: oldMovieId }, select: { tmdbId: true } })
            if (stale && !stale.tmdbId) {
              await prisma.movie.delete({ where: { id: oldMovieId } })
            }
          }
        }
      }
    }
  }

  return { added, changed, removed: 0 }
}

export async function syncEpisodeFile(
  file: ScannedFile,
  scanRootPath?: string,
): Promise<'added' | 'changed' | 'unchanged'> {
  if (file.parsed.type !== 'tv') throw new Error('Expected TV file')
  const { show, year, season: seasonNum, episodes, episodeTitle } = file.parsed
  const specs = file.techSpecs

  // Derive show folder. Standard structure:
  //   <scanRoot>/<ShowFolder>/Season N/<episode.mkv>   → 2 levels up
  // Flat shows (no season subfolder):
  //   <scanRoot>/<ShowFolder>/<episode.mkv>            → 1 level up
  //
  // Detect the flat case: if twoUp equals the scan root, the episode is
  // directly inside the show folder so go only 1 level up.
  // The old second condition (!startsWith) was removed — it misfired when
  // scanRootPath had a trailing slash (double-slash never matches real paths).
  const fileDir = path.dirname(file.path)
  const twoUp = path.dirname(fileDir)
  const showFolder =
    scanRootPath && twoUp === scanRootPath
      ? fileDir
      : twoUp

  const [showArtwork, showNfo, episodeNfo] = await Promise.all([
    detectLocalArtwork(showFolder),
    parseShowNfo(showFolder),
    parseEpisodeNfo(file.path),
  ])

  // Prefer the show title from the NFO `<showtitle>` field — it's more reliable
  // than filename parsing which can vary between episodes of the same show.
  const showTitle = episodeNfo?.showtitle ?? showNfo?.title ?? show

  // Find or create TvShow.
  //
  // Priority 1: anchor on showFolder — find any existing EpisodeFile whose path
  // lives under the show folder and return its TvShow. This is the most reliable
  // signal and prevents duplicate creation when a title varies slightly between
  // files (e.g. year present in one filename but not another, or NFO showtitle
  // differs from a previously-used filename title).
  const existingFileUnderFolder = await prisma.episodeFile.findFirst({
    where: { path: { startsWith: showFolder + path.sep } },
    select: { episode: { select: { season: { select: { showId: true } } } } },
  })
  let tvShow = existingFileUnderFolder
    ? await prisma.tvShow.findUnique({ where: { id: existingFileUnderFolder.episode.season.showId } })
    : null

  // Priority 2: title-based lookup — year is often inconsistently included in
  // episode filenames, which would otherwise create a separate TvShow record per
  // uniquely-named file.
  if (!tvShow) {
    tvShow =
      (year !== null
        ? await prisma.tvShow.findFirst({ where: { title: showTitle, year } })
        : null) ??
      await prisma.tvShow.findFirst({ where: { title: showTitle, year: null } }) ??
      await prisma.tvShow.findFirst({ where: { title: showTitle } })
  }

  if (!tvShow) {
    tvShow = await prisma.tvShow.create({
      data: {
        title: showTitle,
        year: showNfo?.year ?? year,
        tmdbId: showNfo?.tmdbId ?? null,
        tvdbId: showNfo?.tvdbId ?? null,
        overview: showNfo?.overview ?? null,
        rating: showNfo?.rating ?? null,
        genres: showNfo?.genres ?? [],
        posterDownloaded: showArtwork.hasPoster,
        backdropDownloaded: showArtwork.hasBackdrop,
      },
    })
  } else {
    const updates: Record<string, unknown> = {}
    if (!tvShow.year && (showNfo?.year ?? year) !== null) updates['year'] = showNfo?.year ?? year
    if (!tvShow.tmdbId && showNfo?.tmdbId) updates['tmdbId'] = showNfo.tmdbId
    if (!tvShow.tvdbId && showNfo?.tvdbId) updates['tvdbId'] = showNfo.tvdbId
    if (!tvShow.overview && showNfo?.overview) updates['overview'] = showNfo.overview
    if (!tvShow.rating && showNfo?.rating) updates['rating'] = showNfo.rating
    if ((!tvShow.genres || tvShow.genres.length === 0) && showNfo?.genres?.length) updates['genres'] = showNfo.genres
    if (showArtwork.hasPoster) updates['posterDownloaded'] = true
    if (showArtwork.hasBackdrop) updates['backdropDownloaded'] = true
    if (Object.keys(updates).length > 0) {
      await prisma.tvShow.update({ where: { id: tvShow.id }, data: updates })
    }
  }

  // Find or create Season
  let season = await prisma.season.findFirst({
    where: { showId: tvShow.id, seasonNumber: seasonNum },
  })
  if (!season) {
    season = await prisma.season.create({
      data: { showId: tvShow.id, seasonNumber: seasonNum },
    })
  }

  const primaryEp = episodes[0]
  if (primaryEp === undefined) throw new Error('No episode number found')
  const lastEp = episodes[episodes.length - 1]!
  const multiEpisodeEnd = episodes.length > 1 ? lastEp : null

  // NFO title is more accurate than filename parsing; airDate comes only from NFO
  const resolvedTitle = episodeNfo?.title ?? episodeTitle ?? null
  const airDate = episodeNfo?.airDate ? new Date(episodeNfo.airDate) : null

  // Find or create primary Episode
  let episode = await prisma.episode.findFirst({
    where: { seasonId: season.id, episodeNumber: primaryEp },
  })
  if (!episode) {
    episode = await prisma.episode.create({
      data: { seasonId: season.id, episodeNumber: primaryEp, title: resolvedTitle, airDate, status: 'owned' },
    })
  } else {
    const epUpdates: Record<string, unknown> = { status: 'owned' }
    if (resolvedTitle && !episode.title) epUpdates['title'] = resolvedTitle
    if (airDate && !episode.airDate) epUpdates['airDate'] = airDate
    if (episode.status !== 'owned' || Object.keys(epUpdates).length > 1) {
      episode = await prisma.episode.update({
        where: { id: episode.id },
        data: epUpdates,
      })
    }
  }

  // Mark all secondary episodes covered by this multi-episode file as owned
  if (episodes.length > 1) {
    for (let i = 1; i < episodes.length; i++) {
      const secEp = episodes[i]!
      const secondary = await prisma.episode.findFirst({ where: { seasonId: season.id, episodeNumber: secEp } })
      if (secondary && secondary.status !== 'owned') {
        await prisma.episode.update({ where: { id: secondary.id }, data: { status: 'owned' } })
      }
    }
  }

  const fileThreeD = detect3DFormat(file.path)
  const existing = await prisma.episodeFile.findUnique({ where: { path: file.path } })

  if (!existing) {
    await prisma.episodeFile.create({
      data: {
        episodeId: episode.id,
        path: file.path,
        sizeBytes: file.sizeBytes,
        multiEpisodeEnd,
        threeD: fileThreeD,
        videoCodec: specs.videoCodec,
        videoResolution: specs.videoResolution,
        videoQualityTier: specs.videoQualityTier,
        hdr: specs.hdr,
        audioCodec: specs.audioCodec,
        audioChannels: specs.audioChannels,
        audioQualityTier: specs.audioQualityTier,
      },
    })
    await logActivity({ action: 'item_added', showId: tvShow.id, episodeId: episode.id, filePath: file.path }).catch(() => {})
    await updateShowEpisodeCounts(tvShow.id)
    return 'added'
  }

  const wrongEpisode = existing.episodeId !== episode.id
  const wrongMultiEnd = (existing.multiEpisodeEnd ?? null) !== multiEpisodeEnd
  const mtimeChanged = existing.scannedAt.getTime() < file.mtimeMs

  if (wrongEpisode || wrongMultiEnd || mtimeChanged) {
    const oldEpisodeId = existing.episodeId
    await prisma.episodeFile.update({
      where: { path: file.path },
      data: {
        ...(wrongEpisode ? { episodeId: episode.id } : {}),
        multiEpisodeEnd,
        threeD: fileThreeD,
        sizeBytes: file.sizeBytes,
        videoCodec: specs.videoCodec,
        videoResolution: specs.videoResolution,
        videoQualityTier: specs.videoQualityTier,
        hdr: specs.hdr,
        audioCodec: specs.audioCodec,
        audioChannels: specs.audioChannels,
        audioQualityTier: specs.audioQualityTier,
        scannedAt: new Date(),
      },
    })
    // If we re-linked to a different episode, the old one may now have no files → mark missing
    if (wrongEpisode) {
      const remaining = await prisma.episodeFile.count({ where: { episodeId: oldEpisodeId } })
      if (remaining === 0) {
        await prisma.episode.update({ where: { id: oldEpisodeId }, data: { status: 'missing' } })
      }
      await updateShowEpisodeCounts(tvShow.id)
    }
    return 'changed'
  }

  return 'unchanged'
}

// Stable integer hash of a name — used for Person.tmdbId when sourced from NFO (negative to avoid TMDB collisions)
function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0
  return Math.abs(h) || 1
}

async function updateShowEpisodeCounts(showId: string): Promise<void> {
  const owned = await prisma.episode.count({
    where: { season: { showId }, status: 'owned' },
  })
  await prisma.tvShow.update({ where: { id: showId }, data: { ownedEpisodes: owned } })
}

// Remove MovieFile / EpisodeFile records whose paths were not seen in the scan,
// then cascade-delete Movie / Episode / Season / TvShow records that are now empty.
// Returns the count of top-level records removed (movies or shows).
export async function pruneOrphanedFiles(
  scanRootId: string,
  scanRootPath: string,
  rootType: 'movies' | 'tv',
  seenPaths: Set<string>,
): Promise<number> {
  let removed = 0

  if (rootType === 'movies') {
    const dbFiles = await prisma.movieFile.findMany({
      where: { movie: { scanRootId } },
      select: { id: true, path: true, movieId: true },
    })
    const orphaned = dbFiles.filter((f) => !seenPaths.has(f.path))
    if (orphaned.length === 0) return 0

    for (const f of orphaned) {
      await logActivity({ action: 'item_removed', movieId: f.movieId, filePath: f.path }).catch(() => {})
    }

    const orphanedIds = orphaned.map((f) => f.id)
    await prisma.movieFile.deleteMany({ where: { id: { in: orphanedIds } } })

    // Delete Movie records that now have zero files
    const affectedMovieIds = [...new Set(orphaned.map((f) => f.movieId))]
    for (const movieId of affectedMovieIds) {
      const remaining = await prisma.movieFile.count({ where: { movieId } })
      if (remaining === 0) {
        await prisma.movie.delete({ where: { id: movieId } })
        removed++
      }
    }
  } else {
    // For TV roots, find episode files whose path lives under this scan root and wasn't seen.
    // Use scanRootPath + sep to avoid matching a sibling root that shares a path prefix
    // (e.g. /mnt/nas/tv matching /mnt/nas/tv2).
    const dbFiles = await prisma.episodeFile.findMany({
      where: { path: { startsWith: scanRootPath + path.sep } },
      select: { id: true, path: true, episodeId: true },
    })
    const orphaned = dbFiles.filter((f) => !seenPaths.has(f.path))
    if (orphaned.length === 0) return 0

    for (const f of orphaned) {
      await logActivity({ action: 'item_removed', episodeId: f.episodeId, filePath: f.path }).catch(() => {})
    }

    const orphanedIds = orphaned.map((f) => f.id)
    await prisma.episodeFile.deleteMany({ where: { id: { in: orphanedIds } } })

    // Set episodes with no files back to 'missing'
    const affectedEpisodeIds = [...new Set(orphaned.map((f) => f.episodeId))]
    for (const episodeId of affectedEpisodeIds) {
      const remaining = await prisma.episodeFile.count({ where: { episodeId } })
      if (remaining === 0) {
        await prisma.episode.update({ where: { id: episodeId }, data: { status: 'missing' } })
      }
    }

    // Delete ghost seasons: scanner-created seasons with episodeCount=0 that now have no owned episodes
    const affectedSeasons = await prisma.episode.findMany({
      where: { id: { in: affectedEpisodeIds } },
      select: { seasonId: true },
      distinct: ['seasonId'],
    })
    for (const { seasonId } of affectedSeasons) {
      const season = await prisma.season.findUnique({
        where: { id: seasonId },
        select: { episodeCount: true, _count: { select: { episodes: { where: { status: 'owned' } } } } },
      })
      if (season && season.episodeCount === 0 && season._count.episodes === 0) {
        await prisma.episode.deleteMany({ where: { seasonId } })
        await prisma.season.delete({ where: { id: seasonId } })
      }
    }

    // Recalculate show counts for affected shows
    const affectedShowIds = await prisma.episode.findMany({
      where: { id: { in: affectedEpisodeIds } },
      select: { season: { select: { showId: true } } },
    }).then((eps) => [...new Set(eps.map((e) => e.season.showId))])

    for (const showId of affectedShowIds) {
      const owned = await prisma.episode.count({ where: { season: { showId }, status: 'owned' } })
      await prisma.tvShow.update({ where: { id: showId }, data: { ownedEpisodes: owned } })
      removed++
    }
  }

  return removed
}

export async function writeScanLog(
  scanRootId: string | null,
  rootsScanned: string[],
  counts: ScanCounts,
  staleFiles: StaleFileEntry[],
): Promise<string> {
  const log = await prisma.scanLog.create({
    data: {
      scanRootId,
      rootsScanned,
      filesAdded: counts.added,
      filesChanged: counts.changed,
      filesRemoved: counts.removed,
      staleFilesFound: staleFiles.length,
      finishedAt: new Date(),
      staleFiles: {
        create: staleFiles.map((s) => ({ path: s.path, reason: s.reason })),
      },
    },
  })
  return log.id
}

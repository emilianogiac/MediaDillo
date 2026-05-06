import path from 'node:path'
import { prisma, MediaType, CreditRole } from '@mediadillo/db'
import type { ScannedFile } from './types.js'
import type { StaleFileEntry } from './stale-detector.js'
import { detectLocalArtwork } from './artwork-detector.js'
import { parseMovieNfo, parseShowNfo } from './nfo-parser.js'

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
  const { title, year } = file.parsed
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

  // Find or create the Movie record
  let movie = await prisma.movie.findFirst({ where: { title, year: year ?? null, scanRootId } })
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
        videoCodec: specs.videoCodec,
        videoResolution: specs.videoResolution,
        videoQualityTier: specs.videoQualityTier,
        hdr: specs.hdr,
        audioCodec: specs.audioCodec,
        audioChannels: specs.audioChannels,
        audioQualityTier: specs.audioQualityTier,
      },
    })
    return 'added'
  }

  const mtimeChanged = existing.scannedAt.getTime() < file.mtimeMs
  if (mtimeChanged || existing.videoCodec !== specs.videoCodec) {
    await prisma.movieFile.update({
      where: { path: file.path },
      data: {
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
    return 'changed'
  }

  return 'unchanged'
}

export async function syncEpisodeFile(
  file: ScannedFile,
): Promise<'added' | 'changed' | 'unchanged'> {
  if (file.parsed.type !== 'tv') throw new Error('Expected TV file')
  const { show, year, season: seasonNum, episodes, episodeTitle } = file.parsed
  const specs = file.techSpecs

  // Show root folder is 2 levels up from the episode file (show/Season XX/episode.mkv)
  const showFolder = path.dirname(path.dirname(file.path))
  const [showArtwork, showNfo] = await Promise.all([
    detectLocalArtwork(showFolder),
    parseShowNfo(showFolder),
  ])

  // Find or create TvShow
  let tvShow = await prisma.tvShow.findFirst({ where: { title: show, year: year ?? null } })
  if (!tvShow) {
    tvShow = await prisma.tvShow.create({
      data: {
        title: showNfo?.title ?? show,
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

  // Find or create Episode
  let episode = await prisma.episode.findFirst({
    where: { seasonId: season.id, episodeNumber: primaryEp },
  })
  if (!episode) {
    episode = await prisma.episode.create({
      data: { seasonId: season.id, episodeNumber: primaryEp, title: episodeTitle, status: 'owned' },
    })
  } else if (episode.status !== 'owned') {
    episode = await prisma.episode.update({
      where: { id: episode.id },
      data: { status: 'owned', title: episodeTitle ?? episode.title ?? null },
    })
  }

  const existing = await prisma.episodeFile.findUnique({ where: { path: file.path } })

  if (!existing) {
    await prisma.episodeFile.create({
      data: {
        episodeId: episode.id,
        path: file.path,
        sizeBytes: file.sizeBytes,
        videoCodec: specs.videoCodec,
        videoResolution: specs.videoResolution,
        videoQualityTier: specs.videoQualityTier,
        hdr: specs.hdr,
        audioCodec: specs.audioCodec,
        audioChannels: specs.audioChannels,
        audioQualityTier: specs.audioQualityTier,
      },
    })
    await updateShowEpisodeCounts(tvShow.id)
    return 'added'
  }

  const mtimeChanged = existing.scannedAt.getTime() < file.mtimeMs
  if (mtimeChanged) {
    await prisma.episodeFile.update({
      where: { path: file.path },
      data: {
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

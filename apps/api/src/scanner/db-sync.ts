import { prisma } from '@mediadillo/db'
import type { ScannedFile } from './types.js'
import type { StaleFileEntry } from './stale-detector.js'

export interface ScanCounts {
  added: number
  changed: number
  removed: number
}

export async function syncMovieFile(
  file: ScannedFile,
  scanRootId: string,
): Promise<'added' | 'changed' | 'unchanged'> {
  if (file.parsed.type !== 'movie') throw new Error('Expected movie file')
  const { title, year } = file.parsed
  const specs = file.techSpecs

  // Find or create the Movie record (title+year+root as identity until TMDB match in Epic 3)
  let movie = await prisma.movie.findFirst({ where: { title, year: year ?? null, scanRootId } })
  if (!movie) {
    movie = await prisma.movie.create({
      data: { title, year, status: 'owned', scanRootId },
    })
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

  // Find or create TvShow
  let tvShow = await prisma.tvShow.findFirst({ where: { title: show, year: year ?? null } })
  if (!tvShow) {
    tvShow = await prisma.tvShow.create({ data: { title: show, year } })
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

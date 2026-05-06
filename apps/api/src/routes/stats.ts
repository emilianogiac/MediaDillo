import type { FastifyInstance } from 'fastify'
import { prisma } from '@mediadillo/db'

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stats', async (_req, reply) => {
    const [
      movieCount,
      showCount,
      episodeOwnedCount,
      movieFileSizes,
      episodeFileSizes,
      missingPosterMovies,
      missingPosterShows,
      unmatchedMovies,
      unmatchedShows,
      lastScanLog,
    ] = await Promise.all([
      prisma.movie.count({ where: { status: 'owned' } }),
      prisma.tvShow.count(),
      prisma.episode.count({ where: { status: 'owned' } }),
      prisma.movieFile.aggregate({ _sum: { sizeBytes: true } }),
      prisma.episodeFile.aggregate({ _sum: { sizeBytes: true } }),
      prisma.movie.count({ where: { status: 'owned', OR: [{ posterDownloaded: false }, { backdropDownloaded: false }] } }),
      prisma.tvShow.count({ where: { OR: [{ posterDownloaded: false }, { backdropDownloaded: false }] } }),
      prisma.movie.count({ where: { status: 'owned', tmdbId: null } }),
      prisma.tvShow.count({ where: { tmdbId: null } }),
      prisma.scanLog.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { id: true, startedAt: true, finishedAt: true, filesAdded: true, filesChanged: true, filesRemoved: true, staleFilesFound: true },
      }),
    ])

    const movieBytes = movieFileSizes._sum.sizeBytes ?? BigInt(0)
    const episodeBytes = episodeFileSizes._sum.sizeBytes ?? BigInt(0)
    const totalBytes = movieBytes + episodeBytes

    return reply.send({
      movies: movieCount,
      shows: showCount,
      episodesOwned: episodeOwnedCount,
      storageBytesStr: totalBytes.toString(),
      healthIssues: missingPosterMovies + missingPosterShows + unmatchedMovies + unmatchedShows,
      missingArt: missingPosterMovies + missingPosterShows,
      unmatched: unmatchedMovies + unmatchedShows,
      lastScan: lastScanLog,
    })
  })
}

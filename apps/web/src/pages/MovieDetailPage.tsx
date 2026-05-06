import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { MovieDetail } from '../api/types.js'
import { fetchMovie, triggerMovieDownload, fetchMovieImages, selectMovieImage, fetchMovieCandidates, matchMovie } from '../api/movies.js'
import { TechBadge } from '../components/TechBadge.js'
import { ArtworkManager } from '../components/ArtworkManager.js'
import { MatchModal } from '../components/MatchModal.js'

function formatSize(bytes: number | null): string {
  if (!bytes) return '—'
  const gb = bytes / 1_073_741_824
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1_048_576).toFixed(0)} MB`
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function MovieDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [movie, setMovie] = useState<MovieDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMatchModal, setShowMatchModal] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    setLoading(true)
    fetchMovie(id)
      .then(setMovie)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) {
    return <div className="p-6 text-gray-500">Loading…</div>
  }
  if (error || !movie) {
    return (
      <div className="p-6 text-red-400">
        {error ?? 'Movie not found'}
        <Link to="/movies" className="block mt-2 text-sm text-accent hover:underline">
          ← Back to Movies
        </Link>
      </div>
    )
  }

  const directors = movie.credits.filter((c) => c.role === 'director')
  const cast = movie.credits.filter((c) => c.role === 'cast').slice(0, 12)

  return (
    <div className="p-6 space-y-8 max-w-5xl">
      {/* Back link */}
      <Link to="/movies" className="text-sm text-gray-400 hover:text-accent transition-colors">
        ← Movies
      </Link>

      {/* Hero section */}
      <div className="flex gap-6">
        {/* Poster */}
        <div className="flex-shrink-0 w-36 rounded-lg overflow-hidden bg-gray-800 border border-gray-700">
          {(movie.posterDownloaded || movie.posterUrl) ? (
            <img
              src={movie.posterDownloaded ? `/api/artwork/movies/${movie.id}/poster` : movie.posterUrl!}
              alt={movie.title}
              className="w-full object-cover"
            />
          ) : (
            <div className="aspect-[2/3] flex items-center justify-center text-gray-600 text-xs text-center px-2">
              No Poster
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="flex-1 space-y-3">
          <div>
            <h1 className="text-3xl font-bold">{movie.title}</h1>
            {movie.tagline && (
              <p className="text-gray-400 italic mt-0.5">{movie.tagline}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-3 text-sm text-gray-400">
            {movie.year && <span>{movie.year}</span>}
            {movie.runtime && <span>{movie.runtime} min</span>}
            {movie.rating !== null && (
              <span className="text-yellow-400">★ {movie.rating.toFixed(1)}</span>
            )}
            {movie.scanRoot && (
              <span className="text-gray-500">
                {movie.scanRoot.label}
              </span>
            )}
          </div>

          {movie.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {movie.genres.map((g) => (
                <span key={g} className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                  {g}
                </span>
              ))}
            </div>
          )}

          {movie.overview && (
            <p className="text-sm text-gray-300 leading-relaxed max-w-2xl">{movie.overview}</p>
          )}

          {directors.length > 0 && (
            <p className="text-sm text-gray-400">
              <span className="text-gray-500">Director: </span>
              {directors.map((c) => c.person.name).join(', ')}
            </p>
          )}

          {/* External links + match button */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-3 text-xs">
              {movie.tmdbId && (
                <span className="text-gray-500">TMDB #{movie.tmdbId}</span>
              )}
              {movie.imdbId && (
                <span className="text-gray-500">IMDb {movie.imdbId}</span>
              )}
            </div>
            <button
              onClick={() => setShowMatchModal(true)}
              className="text-xs px-2.5 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors"
            >
              {movie.tmdbId ? 'Re-match' : '⚠ Match to TMDB'}
            </button>
          </div>
        </div>
      </div>

      {/* Cast */}
      {cast.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Cast</h2>
          <div className="flex flex-wrap gap-2">
            {cast.map((c) => (
              <div key={c.id} className="text-xs bg-surface-raised border border-gray-700 rounded px-2 py-1">
                <span className="text-gray-100">{c.person.name}</span>
                {c.character && (
                  <span className="text-gray-500 ml-1">as {c.character}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Files */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Files</h2>
        {movie.files.length === 0 ? (
          <p className="text-sm text-gray-500">No files found for this movie.</p>
        ) : (
          <div className="space-y-2">
            {movie.files.map((file) => (
              <div
                key={file.id}
                className="bg-surface-raised border border-gray-700 rounded-lg px-4 py-3 space-y-2"
              >
                <p className="text-xs text-gray-400 font-mono break-all">{file.path}</p>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {file.videoQualityTier && (
                    <TechBadge label={file.videoQualityTier} variant="quality" />
                  )}
                  {file.hdr && <TechBadge label="HDR" variant="hdr" />}
                  {file.videoCodec && <TechBadge label={file.videoCodec} />}
                  {file.videoResolution && (
                    <TechBadge label={file.videoResolution} />
                  )}
                  {file.audioCodec && <TechBadge label={file.audioCodec} />}
                  {file.audioChannels && <TechBadge label={file.audioChannels} />}
                  {file.audioQualityTier && (
                    <TechBadge label={file.audioQualityTier} />
                  )}
                  <span className="text-xs text-gray-500 ml-auto">
                    {formatSize(Number(file.sizeBytes))}
                    {file.durationS ? ` · ${formatDuration(file.durationS)}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Artwork Manager */}
      <ArtworkManager
        posterDownloaded={movie.posterDownloaded}
        backdropDownloaded={movie.backdropDownloaded}
        api={{
          download: (type) => triggerMovieDownload(movie.id, type),
          searchImages: () => fetchMovieImages(movie.id),
          selectImage: (filePath, artworkType) => selectMovieImage(movie.id, filePath, artworkType),
        }}
        onUpdated={load}
      />

      {showMatchModal && (
        <MatchModal
          mediaType="movie"
          id={movie.id}
          currentTitle={movie.title}
          currentTmdbId={movie.tmdbId}
          fetchCandidates={fetchMovieCandidates}
          onMatch={matchMovie}
          onClose={() => setShowMatchModal(false)}
          onMatched={() => { setShowMatchModal(false); load() }}
        />
      )}
    </div>
  )
}

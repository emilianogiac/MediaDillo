import { Link } from 'react-router-dom'
import type { MovieSummary } from '../api/types.js'
import { TechBadge } from './TechBadge.js'

interface Props {
  movie: MovieSummary
}

export function PosterCard({ movie }: Props) {
  const qualityTier = movie.files[0]?.videoQualityTier
  const missingPoster = !movie.posterDownloaded
  const missingBackdrop = !movie.backdropDownloaded
  const unmatched = !movie.tmdbId

  return (
    <Link
      to={`/movies/${movie.id}`}
      className="group relative flex flex-col rounded-lg overflow-hidden bg-surface-raised border border-gray-800 hover:border-accent/60 transition-colors"
    >
      {/* Poster image */}
      <div className="aspect-[2/3] bg-gray-800 overflow-hidden">
        {(movie.posterDownloaded || movie.posterUrl) ? (
          <img
            src={movie.posterDownloaded ? `/api/artwork/movies/${movie.id}/poster` : movie.posterUrl!}
            alt={movie.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm px-2 text-center">
            No Poster
          </div>
        )}
      </div>

      {/* Health badges — top-right overlay */}
      {(unmatched || missingPoster || missingBackdrop) && (
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 items-end">
          {unmatched && (
            <span className="bg-red-600/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">
              Unmatched
            </span>
          )}
          {!unmatched && (missingPoster || missingBackdrop) && (
            <span className="bg-yellow-500/90 text-yellow-900 text-xs px-1.5 py-0.5 rounded font-medium">
              Art missing
            </span>
          )}
        </div>
      )}

      {/* Quality badge — bottom-left overlay */}
      {qualityTier && (
        <div className="absolute bottom-9 left-1.5">
          <TechBadge label={qualityTier} variant="quality" />
        </div>
      )}

      {/* Title strip */}
      <div className="p-2">
        <p className="text-xs font-medium text-gray-100 truncate">{movie.title}</p>
        <p className="text-xs text-gray-500">{movie.year ?? '—'}</p>
      </div>
    </Link>
  )
}

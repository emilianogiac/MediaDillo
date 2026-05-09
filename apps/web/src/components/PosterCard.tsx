import { Link } from 'react-router-dom'
import type { MovieSummary } from '../api/types.js'
import { TechBadge } from './TechBadge.js'

interface Props {
  movie: MovieSummary
  version: number
  onArtworkDownload?: () => void
}

export function PosterCard({ movie, version, onArtworkDownload }: Props) {
  const qualityTier = movie.files[0]?.videoQualityTier
  const missingFile = movie.files.length === 0
  const missingPoster = !movie.posterDownloaded
  const missingBackdrop = !movie.backdropDownloaded
  const unmatched = !movie.tmdbId
  const isDuplicate = movie.duplicateCount > 1

  return (
    <Link
      to={`/movies/${movie.id}`}
      className="group relative flex flex-col rounded-lg overflow-hidden bg-surface-raised border border-gray-800 hover:border-accent/60 transition-colors"
    >
      {/* Poster image */}
      <div className="aspect-[2/3] bg-gray-800 overflow-hidden">
        {(movie.posterDownloaded || movie.posterUrl) ? (
          <img
            src={movie.posterDownloaded ? `/api/artwork/movies/${movie.id}/poster?v=${version}` : movie.posterUrl!}
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
      {(missingFile || unmatched || missingPoster || missingBackdrop || isDuplicate) && (
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 items-end">
          {missingFile && (
            <span className="bg-red-700/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">
              Missing file
            </span>
          )}
          {!missingFile && unmatched && (
            <span className="bg-red-600/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">
              Unmatched
            </span>
          )}
          {!missingFile && !unmatched && (missingPoster || missingBackdrop) && (
            <span className="bg-yellow-500/90 text-yellow-900 text-xs px-1.5 py-0.5 rounded font-medium">
              Art missing
            </span>
          )}
          {isDuplicate && (
            <span className="bg-orange-500/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">
              {movie.duplicateCount}×
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

      {/* Organized badge — bottom-right overlay */}
      {movie.isOrganized && (
        <div className="absolute bottom-9 right-1.5">
          <span className="bg-green-600/90 text-white text-xs px-1 py-0.5 rounded font-medium">✓</span>
        </div>
      )}

      {/* Hover quick-action overlay */}
      {onArtworkDownload && (
        <div className="absolute inset-x-0 bottom-9 flex items-end justify-center pb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onArtworkDownload() }}
            className="bg-black/70 hover:bg-black/90 text-yellow-300 text-xs px-2.5 py-1 rounded-full border border-yellow-500/40 backdrop-blur-sm transition-colors"
          >
            Get Art
          </button>
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

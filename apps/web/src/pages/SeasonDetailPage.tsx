import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { SeasonDetail, EpisodeDetail } from '../api/types.js'
import { fetchSeason } from '../api/shows.js'
import { TechBadge } from '../components/TechBadge.js'

const STATUS_STYLES: Record<EpisodeDetail['status'], string> = {
  owned: 'bg-green-700/60 text-green-300',
  missing: 'bg-red-800/60 text-red-300',
  not_yet_aired: 'bg-gray-700/60 text-gray-400',
  ignored: 'bg-gray-800/60 text-gray-500',
}

const STATUS_LABELS: Record<EpisodeDetail['status'], string> = {
  owned: 'Owned',
  missing: 'Missing',
  not_yet_aired: 'Not aired',
  ignored: 'Ignored',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function SeasonDetailPage() {
  const { id, seasonNumber } = useParams<{ id: string; seasonNumber: string }>()
  const [season, setSeason] = useState<SeasonDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id || !seasonNumber) return
    setLoading(true)
    fetchSeason(id, parseInt(seasonNumber, 10))
      .then(setSeason)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [id, seasonNumber])

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>
  if (error || !season) {
    return (
      <div className="p-6 text-red-400">
        {error ?? 'Season not found'}
        {id && (
          <Link to={`/shows/${id}`} className="block mt-2 text-sm text-accent hover:underline">
            ← Back to Show
          </Link>
        )}
      </div>
    )
  }

  const owned = season.episodes.filter((e) => e.status === 'owned').length
  const total = season.episodes.length

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link to="/shows" className="hover:text-accent transition-colors">TV Shows</Link>
        <span className="text-gray-600">›</span>
        <Link to={`/shows/${season.show.id}`} className="hover:text-accent transition-colors">
          {season.show.title}
        </Link>
        <span className="text-gray-600">›</span>
        <span className="text-gray-200">Season {season.seasonNumber}</span>
      </div>

      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">Season {season.seasonNumber}</h1>
        <span className="text-sm text-gray-500">{owned}/{total} owned</span>
      </div>

      {/* Episode list */}
      <div className="space-y-2">
        {season.episodes.map((ep) => (
          <div
            key={ep.id}
            className="bg-surface-raised border border-gray-700 rounded-lg px-4 py-3 space-y-2"
          >
            <div className="flex items-start gap-3">
              {/* Episode number */}
              <span className="text-sm font-mono text-gray-500 w-8 flex-shrink-0 pt-0.5">
                {String(ep.episodeNumber).padStart(2, '0')}
              </span>

              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-100 truncate">
                    {ep.title ?? `Episode ${ep.episodeNumber}`}
                  </span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${STATUS_STYLES[ep.status]}`}
                  >
                    {STATUS_LABELS[ep.status]}
                  </span>
                </div>
                {ep.airDate && (
                  <p className="text-xs text-gray-500">{formatDate(ep.airDate)}</p>
                )}
              </div>
            </div>

            {/* File info */}
            {ep.files.length > 0 && (
              <div className="pl-11 space-y-1.5">
                {ep.files.map((file) => (
                  <div key={file.id} className="space-y-1">
                    <p className="text-xs text-gray-500 font-mono truncate">{file.path}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {file.videoQualityTier && (
                        <TechBadge label={file.videoQualityTier} variant="quality" />
                      )}
                      {file.hdr && <TechBadge label="HDR" variant="hdr" />}
                      {file.videoCodec && <TechBadge label={file.videoCodec} />}
                      {file.audioCodec && <TechBadge label={file.audioCodec} />}
                      {file.audioChannels && <TechBadge label={file.audioChannels} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {season.episodes.length === 0 && (
          <p className="text-gray-500 text-sm py-8 text-center">No episodes found for this season.</p>
        )}
      </div>
    </div>
  )
}

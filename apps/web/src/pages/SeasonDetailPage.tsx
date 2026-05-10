import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { SeasonDetail, EpisodeDetail } from '../api/types.js'
import { fetchSeason, rescanSeason, fetchSeasonRenamePreview, type RescanResult } from '../api/shows.js'
import { fetchEpisodeFileRenamePreview, applyRenames, type RenamePreviewItem } from '../api/files.js'
import { TechBadge } from '../components/TechBadge.js'
import { MergePartsPanel } from '../components/MergePartsPanel.js'
import { EpisodeRenamePanel } from '../components/EpisodeRenamePanel.js'
import { useToast } from '../context/ToastContext.js'

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

function shortName(p: string) {
  return p.split('/').pop() ?? p
}

interface EpisodeRenameInlineProps {
  fileIds: string[]
  onDone: () => void
}

function EpisodeRenameInline({ fileIds, onDone }: EpisodeRenameInlineProps) {
  const { toast } = useToast()
  const [state, setState] = useState<'idle' | 'loading' | 'clean' | 'preview' | 'applying'>('idle')
  const [items, setItems] = useState<RenamePreviewItem[]>([])

  async function check() {
    setState('loading')
    try {
      const preview = await fetchEpisodeFileRenamePreview(fileIds)
      const needsRename = preview.filter((p) => p.needsRename && p.type === 'episode-file')
      setItems(needsRename)
      setState(needsRename.length === 0 ? 'clean' : 'preview')
    } catch {
      setState('idle')
    }
  }

  async function apply() {
    setState('applying')
    try {
      const result = await applyRenames('episodes', items.map((i) => i.id))
      toast({ type: 'success', message: `${result.renamed} file${result.renamed !== 1 ? 's' : ''} renamed` })
      setState('idle')
      onDone()
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Rename failed' })
      setState('preview')
    }
  }

  if (state === 'idle') {
    return (
      <button onClick={check} className="text-xs text-gray-500 hover:text-accent transition-colors">
        Rename
      </button>
    )
  }
  if (state === 'loading') return <span className="text-xs text-gray-500">…</span>
  if (state === 'clean') return <span className="text-xs text-green-600">✓ canonical</span>
  if (state === 'applying') return <span className="text-xs text-gray-500">Renaming…</span>
  if (state === 'preview') {
    return (
      <div className="space-y-1">
        {items.map((item) => (
          <p key={item.id} className="text-xs text-gray-400 font-mono truncate" title={item.proposedPath}>
            → {shortName(item.proposedPath)}
          </p>
        ))}
        <button onClick={apply} className="text-xs text-accent hover:underline">
          Apply rename
        </button>
      </div>
    )
  }
  return null
}

export function SeasonDetailPage() {
  const { id, seasonNumber } = useParams<{ id: string; seasonNumber: string }>()
  const [season, setSeason] = useState<SeasonDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rescanning, setRescanning] = useState(false)
  const [rescanResult, setRescanResult] = useState<RescanResult | null>(null)

  const load = useCallback(() => {
    if (!id || !seasonNumber) return
    setLoading(true)
    fetchSeason(id, parseInt(seasonNumber, 10))
      .then(setSeason)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [id, seasonNumber])

  useEffect(() => { load() }, [load])

  async function handleRescan() {
    if (!id || !seasonNumber) return
    setRescanning(true)
    setRescanResult(null)
    try {
      const result = await rescanSeason(id, parseInt(seasonNumber, 10))
      setRescanResult(result)
      load()
    } catch {
      // ignore, button will just stop spinning
    } finally {
      setRescanning(false)
    }
  }

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

  const seasonNum = parseInt(seasonNumber ?? '0', 10)
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

      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Season {season.seasonNumber}</h1>
        <span className="text-sm text-gray-500">{owned}/{total} owned</span>
        <button
          onClick={handleRescan}
          disabled={rescanning}
          className="ml-auto text-xs px-3 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors disabled:opacity-40"
        >
          {rescanning ? 'Scanning…' : 'Rescan'}
        </button>
        {rescanResult && (
          <span className={`text-xs ${rescanResult.folderFound ? 'text-gray-500' : 'text-red-400'}`}>
            {!rescanResult.folderFound
              ? 'Folder not found on disk'
              : rescanResult.added + rescanResult.changed + rescanResult.removed === 0 && rescanResult.filesSkipped.length === 0
              ? `Up to date (${rescanResult.filesFound} file${rescanResult.filesFound !== 1 ? 's' : ''} scanned)`
              : [
                  rescanResult.filesFound > 0 && `${rescanResult.filesFound} found`,
                  rescanResult.added > 0 && `${rescanResult.added} added`,
                  rescanResult.changed > 0 && `${rescanResult.changed} changed`,
                  rescanResult.removed > 0 && `${rescanResult.removed} removed`,
                  rescanResult.filesSkipped.length > 0 && `${rescanResult.filesSkipped.length} skipped`,
                ].filter(Boolean).join(', ')}
          </span>
        )}
      </div>

      {/* Rescan skipped files */}
      {rescanResult && rescanResult.filesSkipped.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-yellow-400">Skipped files</p>
          {rescanResult.filesSkipped.map((f, i) => (
            <div key={i} className="text-xs text-gray-400 font-mono truncate" title={f.path}>
              <span className="text-yellow-600">{f.reason}</span>
              {' — '}
              {f.path.split('/').pop()}
            </div>
          ))}
        </div>
      )}

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

              {/* Episode-level rename */}
              {ep.files.length > 0 && id && (
                <div className="flex-shrink-0 pt-0.5">
                  <EpisodeRenameInline
                    key={ep.id}
                    fileIds={ep.files.map((f) => f.id)}
                    onDone={load}
                  />
                </div>
              )}
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

      {/* Season-level rename panel */}
      {id && (
        <EpisodeRenamePanel
          title="Rename Season Episodes"
          fetchPreview={() => fetchSeasonRenamePreview(id, seasonNum)}
          onDone={load}
        />
      )}

      {id && seasonNumber && (
        <MergePartsPanel
          showId={id}
          seasonNumber={parseInt(seasonNumber, 10)}
          episodes={season.episodes}
          onDone={load}
        />
      )}
    </div>
  )
}

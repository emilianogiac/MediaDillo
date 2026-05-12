import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { SeasonDetail, EpisodeDetail } from '../api/types.js'
import { fetchSeason, rescanSeason, fetchSeasonRenamePreview, type RescanResult } from '../api/shows.js'
import { fetchEpisodeFileRenamePreview, applyRenames, type RenamePreviewItem } from '../api/files.js'
import { TechBadge } from '../components/TechBadge.js'
import { MergePartsPanel } from '../components/MergePartsPanel.js'
import { AssignFilesPanel } from '../components/AssignFilesPanel.js'
import { EpisodeRenamePanel } from '../components/EpisodeRenamePanel.js'
import { ReorderEpisodesPanel } from '../components/ReorderEpisodesPanel.js'
import { useToast } from '../context/ToastContext.js'

function Spinner() {
  return <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-600 border-t-accent animate-spin flex-shrink-0" />
}

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
  const [state, setState] = useState<'idle' | 'loading' | 'clean' | 'preview' | 'applying' | 'error'>('idle')
  const [items, setItems] = useState<RenamePreviewItem[]>([])
  const [renameErrors, setRenameErrors] = useState<string[]>([])

  async function check() {
    setState('loading')
    setRenameErrors([])
    try {
      const preview = await fetchEpisodeFileRenamePreview(fileIds)
      const needsRename = preview.filter((p) => p.needsRename && p.type === 'episode-file')
      setItems(needsRename)
      setState(needsRename.length === 0 ? 'clean' : 'preview')
    } catch (e) {
      setRenameErrors([e instanceof Error ? e.message : 'Failed to load preview'])
      setState('error')
    }
  }

  async function apply() {
    setState('applying')
    setRenameErrors([])
    try {
      const result = await applyRenames('episodes', items.map((i) => i.id))
      if (result.errors.length > 0) setRenameErrors(result.errors)
      setState('idle')
      onDone()
    } catch (e) {
      setRenameErrors([e instanceof Error ? e.message : 'Rename failed'])
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
  if (state === 'loading') return <span className="flex items-center gap-1.5"><Spinner /><span className="text-xs text-gray-500">Checking…</span></span>
  if (state === 'applying') return <span className="flex items-center gap-1.5"><Spinner /><span className="text-xs text-gray-500">Renaming…</span></span>
  if (state === 'clean') return <span className="text-xs text-green-600">✓ canonical</span>
  if (state === 'error') {
    return (
      <div className="space-y-1">
        {renameErrors.map((e, i) => <p key={i} className="text-xs text-red-400">✗ {e}</p>)}
        <button onClick={check} className="text-xs text-gray-500 hover:text-accent">Retry</button>
      </div>
    )
  }
  if (state === 'preview') {
    return (
      <div className="space-y-1">
        {renameErrors.map((e, i) => <p key={i} className="text-xs text-red-400">✗ {e}</p>)}
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
  const showsSearch = (() => { try { return sessionStorage.getItem('mediaDillo.showsSearch') ?? '' } catch { return '' } })()
  const [season, setSeason] = useState<SeasonDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rescanning, setRescanning] = useState(false)
  const [rescanResult, setRescanResult] = useState<RescanResult | null>(null)
  const [rescanError, setRescanError] = useState<string | null>(null)
  const [showMissing, setShowMissing] = useState(true)

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
    setRescanError(null)
    try {
      const result = await rescanSeason(id, parseInt(seasonNumber, 10))
      setRescanResult(result)
    } catch (e) {
      setRescanError(e instanceof Error ? e.message : 'Rescan failed')
    } finally {
      setRescanning(false)
      load()
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
  const total = season.episodeCount
  const visibleEpisodes = showMissing
    ? season.episodes
    : season.episodes.filter((e) => e.status === 'owned')

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link to={`/shows${showsSearch}`} className="hover:text-accent transition-colors">TV Shows</Link>
        <span className="text-gray-600">›</span>
        <Link to={`/shows/${season.show.id}`} className="hover:text-accent transition-colors">
          {season.show.title}
        </Link>
        <span className="text-gray-600">›</span>
        <span className="text-gray-200">{season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`}</span>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">{season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`}</h1>
        <span className="text-sm text-gray-500">{owned}/{total} owned</span>
        <button
          onClick={() => setShowMissing((v) => !v)}
          className={`text-xs px-3 py-1 rounded border transition-colors ${
            showMissing
              ? 'border-accent/60 text-accent'
              : 'border-gray-600 text-gray-500 hover:border-gray-500'
          }`}
        >
          {showMissing ? 'Hide missing' : 'Show missing'}
        </button>
        <button
          onClick={handleRescan}
          disabled={rescanning}
          className="ml-auto text-xs px-3 py-1 rounded border border-gray-600 hover:border-accent/60 text-gray-400 hover:text-accent transition-colors disabled:opacity-40 flex items-center gap-1.5"
        >
          {rescanning && <Spinner />}
          {rescanning ? 'Scanning…' : 'Rescan'}
        </button>
      </div>

      {/* Rescan status */}
      {(rescanning || rescanError || rescanResult) && (
        <div className={`rounded-lg border px-4 py-3 space-y-2 text-sm ${
          rescanError ? 'bg-red-900/20 border-red-700/40' :
          rescanResult && !rescanResult.folderFound ? 'bg-red-900/20 border-red-700/40' :
          'bg-surface-raised border-gray-700'
        }`}>
          {rescanning && (
            <div className="flex items-center gap-2 text-gray-400">
              <Spinner />
              <span>Scanning season folder…</span>
            </div>
          )}
          {rescanError && (
            <p className="text-red-400">✗ {rescanError}</p>
          )}
          {rescanResult && !rescanning && (
            <p className={rescanResult.folderFound ? 'text-gray-300' : 'text-red-400'}>
              {!rescanResult.folderFound
                ? '✗ Season folder not found on disk'
                : [
                    `${rescanResult.filesFound} file${rescanResult.filesFound !== 1 ? 's' : ''} scanned`,
                    rescanResult.added > 0 && `${rescanResult.added} added`,
                    rescanResult.changed > 0 && `${rescanResult.changed} changed`,
                    rescanResult.removed > 0 && `${rescanResult.removed} removed`,
                    rescanResult.filesSkipped.length > 0 && `${rescanResult.filesSkipped.length} skipped`,
                  ].filter(Boolean).join(' · ')}
            </p>
          )}
          {rescanResult?._debug && (
            <p className="text-xs text-gray-600 font-mono truncate" title={rescanResult._debug.seasonFolderPath}>
              folder: {rescanResult._debug.seasonFolderPath}
            </p>
          )}
          {rescanResult?.filesSkipped.length ? (
            <div className="space-y-1 pt-1 border-t border-gray-700/60">
              <p className="text-xs font-medium text-yellow-400">Skipped</p>
              {rescanResult.filesSkipped.map((f, i) => (
                <p key={i} className="text-xs text-gray-400 font-mono truncate" title={f.path}>
                  <span className="text-yellow-600">{f.reason}</span>{' — '}{f.path.split('/').pop()}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Episode list */}
      <div className="space-y-2">
        {visibleEpisodes.map((ep) => {
          const outOfBounds = ep.episodeNumber > season.episodeCount
          return (
          <div
            key={ep.id}
            className={`rounded-lg px-4 py-3 space-y-2 border ${
              outOfBounds
                ? 'bg-orange-900/20 border-orange-700/50'
                : 'bg-surface-raised border-gray-700'
            }`}
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
        )})}

        {visibleEpisodes.length === 0 && (
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

      {id && (
        <ReorderEpisodesPanel
          showId={id}
          seasonNumber={seasonNum}
          episodes={season.episodes}
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

      {id && (
        <AssignFilesPanel
          showId={id}
          seasonNumber={seasonNum}
          episodes={season.episodes}
          onDone={load}
        />
      )}
    </div>
  )
}

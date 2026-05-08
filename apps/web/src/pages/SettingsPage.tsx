import { useState, useEffect, useCallback } from 'react'
import type { JellyfinStatus } from '../api/jellyfin.js'
import { fetchJellyfinStatus, triggerJellyfinRefresh } from '../api/jellyfin.js'
import { downloadJson, downloadMoviesCsv, downloadShowsCsv, writeBulkNfo } from '../api/export.js'
import { cleanupTvContamination } from '../api/movies.js'
import type { ScanRootRecord, ScanLogRecord, ScheduleInterval } from '../api/settings.js'
import {
  fetchAllScanRoots, createScanRoot, updateScanRoot, deleteScanRoot,
  fetchScanLogs, fetchSchedule, updateSchedule, dedupShows, verifyIntegrity,
  fetchAutoCleanup, updateAutoCleanup,
} from '../api/settings.js'

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`}
    />
  )
}

function JellyfinCard() {
  const [status, setStatus] = useState<JellyfinStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)

  useEffect(() => {
    fetchJellyfinStatus()
      .then(setStatus)
      .catch(() => setStatus({ configured: false, connected: false }))
      .finally(() => setLoading(false))
  }, [])

  async function manualRefresh() {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      await triggerJellyfinRefresh()
      setRefreshMsg('Library refresh triggered.')
    } catch (e) {
      setRefreshMsg(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="bg-surface-raised border border-gray-700 rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Jellyfin</h2>

      {loading && <p className="text-sm text-gray-500">Checking connection…</p>}

      {!loading && status && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {status.configured ? (
              <>
                <StatusDot ok={status.connected} />
                <span className="text-sm text-gray-300">
                  {status.connected
                    ? `Connected — ${status.serverName ?? 'Jellyfin'} v${status.version ?? '?'}`
                    : `Not reachable — ${status.error ?? 'unknown error'}`}
                </span>
              </>
            ) : (
              <>
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-600" />
                <span className="text-sm text-gray-500">
                  Not configured — set <code className="text-xs bg-gray-800 px-1 rounded">JELLYFIN_URL</code> and{' '}
                  <code className="text-xs bg-gray-800 px-1 rounded">JELLYFIN_API_KEY</code> in your environment.
                </span>
              </>
            )}
          </div>

          {status.configured && status.connected && (
            <>
              <button
                onClick={manualRefresh}
                disabled={refreshing}
                className="text-sm px-3 py-1.5 rounded bg-surface-overlay hover:bg-gray-600 disabled:opacity-40 transition-colors"
              >
                {refreshing ? 'Refreshing…' : 'Trigger library refresh'}
              </button>
              {refreshMsg && (
                <p className="text-xs text-gray-400">{refreshMsg}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function SettingsPage() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <JellyfinCard />

      <div className="bg-surface-raised border border-gray-700 rounded-lg p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-3">
          API Keys
        </h2>
        <p className="text-sm text-gray-500">
          API keys are configured via environment variables in your <code className="text-xs bg-gray-800 px-1 rounded">.env</code> file:
        </p>
        <ul className="mt-2 space-y-1 text-sm text-gray-500">
          <li><code className="text-xs bg-gray-800 px-1 rounded">TMDB_API_KEY</code> — required for metadata and artwork (v3 auth key from themoviedb.org)</li>
          <li><code className="text-xs bg-gray-800 px-1 rounded">TVDB_API_KEY</code> — optional, used as fallback for TV episode numbering edge cases</li>
        </ul>
      </div>

      <ExportCard />
      <DatabaseMaintenanceCard />
      <ScanRootsCard />
      <ScheduleCard />
      <MatchBehaviorCard />
      <ScanLogsCard />
    </div>
  )
}

function DatabaseMaintenanceCard() {
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<string | null>(null)
  const [cleanupError, setCleanupError] = useState<string | null>(null)

  const [dedupBusy, setDedupBusy] = useState(false)
  const [dedupResult, setDedupResult] = useState<string | null>(null)
  const [dedupError, setDedupError] = useState<string | null>(null)

  const [integrityBusy, setIntegrityBusy] = useState(false)
  const [integrityResult, setIntegrityResult] = useState<string | null>(null)
  const [integrityError, setIntegrityError] = useState<string | null>(null)

  async function runCleanup() {
    setCleanupBusy(true)
    setCleanupResult(null)
    setCleanupError(null)
    try {
      const r = await cleanupTvContamination()
      setCleanupResult(r.deleted === 0
        ? 'No contaminated records found — library is clean.'
        : `Removed ${r.deleted} movie record${r.deleted !== 1 ? 's' : ''} that belonged to TV scan roots. Run a full scan to rebuild them as episodes.`)
    } catch (e) {
      setCleanupError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setCleanupBusy(false)
    }
  }

  async function runDedup() {
    setDedupBusy(true)
    setDedupResult(null)
    setDedupError(null)
    try {
      const r = await dedupShows()
      setDedupResult(r.deleted === 0
        ? 'No duplicate TV show records found.'
        : `Merged ${r.merged} duplicate show${r.merged !== 1 ? 's' : ''} into their canonical records.`)
    } catch (e) {
      setDedupError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setDedupBusy(false)
    }
  }

  return (
    <div className="bg-surface-raised border border-gray-700 rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Database Maintenance</h2>
      <div className="space-y-1.5">
        <p className="text-sm text-gray-500">
          Remove movie records that were incorrectly created from TV scan roots (caused by the pre-fix scanner routing bug).
          After cleanup, run a full scan to correctly index those files as episodes.
        </p>
        <button
          onClick={runCleanup}
          disabled={cleanupBusy}
          className="text-sm px-3 py-1.5 rounded bg-surface-overlay hover:bg-gray-600 disabled:opacity-40 transition-colors"
        >
          {cleanupBusy ? 'Cleaning up…' : 'Remove contaminated movie records'}
        </button>
        {cleanupError && <p className="text-xs text-red-400">{cleanupError}</p>}
        {cleanupResult && <p className="text-xs text-green-400">{cleanupResult}</p>}
      </div>
      <div className="border-t border-gray-700 pt-3 space-y-1.5">
        <p className="text-sm text-gray-500">
          Merge duplicate TV show records caused by inconsistent year inclusion in episode filenames (e.g. some files named <code className="bg-gray-800 px-1 rounded">Show (2019) - 01x01</code> and others just <code className="bg-gray-800 px-1 rounded">Show - 01x02</code>).
        </p>
        <button
          onClick={runDedup}
          disabled={dedupBusy}
          className="text-sm px-3 py-1.5 rounded bg-surface-overlay hover:bg-gray-600 disabled:opacity-40 transition-colors"
        >
          {dedupBusy ? 'Merging…' : 'Merge duplicate TV show records'}
        </button>
        {dedupError && <p className="text-xs text-red-400">{dedupError}</p>}
        {dedupResult && <p className="text-xs text-green-400">{dedupResult}</p>}
      </div>
      <div className="border-t border-gray-700 pt-3 space-y-1.5">
        <p className="text-sm text-gray-500">
          Check every file record against the filesystem and remove entries for files that no longer exist on disk. Movies with no remaining files are deleted; episodes revert to "missing". Also runs automatically at the end of every scan.
        </p>
        <button
          onClick={async () => {
            setIntegrityBusy(true); setIntegrityResult(null); setIntegrityError(null)
            try {
              const r = await verifyIntegrity()
              setIntegrityResult(
                r.moviesRemoved === 0 && r.episodesLost === 0
                  ? 'All file records are healthy — nothing removed.'
                  : `Removed ${r.moviesRemoved} movie${r.moviesRemoved !== 1 ? 's' : ''} and marked ${r.episodesLost} episode${r.episodesLost !== 1 ? 's' : ''} as missing.`
              )
            } catch (e) {
              setIntegrityError(e instanceof Error ? e.message : 'Failed')
            } finally {
              setIntegrityBusy(false)
            }
          }}
          disabled={integrityBusy}
          className="text-sm px-3 py-1.5 rounded bg-surface-overlay hover:bg-gray-600 disabled:opacity-40 transition-colors"
        >
          {integrityBusy ? 'Checking…' : 'Verify library integrity'}
        </button>
        {integrityError && <p className="text-xs text-red-400">{integrityError}</p>}
        {integrityResult && <p className="text-xs text-green-400">{integrityResult}</p>}
      </div>
    </div>
  )
}

function ExportCard() {
  const [nfoResult, setNfoResult] = useState<{ movies: number; shows: number; errors: string[] } | null>(null)
  const [nfoBusy, setNfoBusy] = useState(false)
  const [nfoError, setNfoError] = useState<string | null>(null)

  async function runBulkNfo() {
    setNfoBusy(true)
    setNfoResult(null)
    setNfoError(null)
    try {
      const result = await writeBulkNfo()
      setNfoResult(result)
    } catch (e) {
      setNfoError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setNfoBusy(false)
    }
  }

  return (
    <div className="bg-surface-raised border border-gray-700 rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Export & NFO</h2>

      <div className="space-y-2">
        <p className="text-sm text-gray-500">Download your full library data as JSON or CSV.</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={downloadJson}
            className="text-sm px-3 py-1.5 rounded bg-surface-overlay hover:bg-gray-600 transition-colors"
          >
            Export JSON
          </button>
          <button
            onClick={downloadMoviesCsv}
            className="text-sm px-3 py-1.5 rounded bg-surface-overlay hover:bg-gray-600 transition-colors"
          >
            Movies CSV
          </button>
          <button
            onClick={downloadShowsCsv}
            className="text-sm px-3 py-1.5 rounded bg-surface-overlay hover:bg-gray-600 transition-colors"
          >
            Shows CSV
          </button>
        </div>
      </div>

      <div className="border-t border-gray-800 pt-4 space-y-2">
        <p className="text-sm text-gray-500">
          Write Jellyfin/Kodi-compatible NFO sidecar files alongside all media files.
        </p>
        <button
          onClick={runBulkNfo}
          disabled={nfoBusy}
          className="text-sm px-3 py-1.5 rounded bg-surface-overlay hover:bg-gray-600 disabled:opacity-40 transition-colors"
        >
          {nfoBusy ? 'Writing NFO files…' : 'Write all NFO files'}
        </button>
        {nfoError && <p className="text-xs text-red-400">{nfoError}</p>}
        {nfoResult && (
          <p className="text-xs text-green-400">
            Written: {nfoResult.movies} movie NFO{nfoResult.movies !== 1 ? 's' : ''},{' '}
            {nfoResult.shows} show NFO{nfoResult.shows !== 1 ? 's' : ''}.
            {nfoResult.errors.length > 0 && ` (${nfoResult.errors.length} errors)`}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scan Roots card
// ---------------------------------------------------------------------------

function ScanRootsCard() {
  const [roots, setRoots] = useState<ScanRootRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<'movies' | 'tv'>('movies')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRoots(await fetchAllScanRoots())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleEnabled(root: ScanRootRecord) {
    try {
      const updated = await updateScanRoot(root.id, { enabled: !root.enabled })
      setRoots((prev) => prev.map((r) => r.id === root.id ? updated : r))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      await deleteScanRoot(id)
      setRoots((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    if (!newPath.trim() || !newLabel.trim()) return
    setBusy(true)
    try {
      const root = await createScanRoot({ path: newPath.trim(), label: newLabel.trim(), type: newType })
      setRoots((prev) => [...prev, root])
      setShowAdd(false)
      setNewPath('')
      setNewLabel('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface-raised border border-gray-700 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Scan Roots</h2>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="text-xs px-2 py-1 rounded bg-surface-overlay hover:bg-gray-600 transition-colors"
        >
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {showAdd && (
        <div className="grid grid-cols-1 gap-2 bg-surface p-3 rounded-lg border border-gray-700">
          <input
            placeholder="Path (e.g. /mnt/nas/films)"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            className="bg-surface border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <input
              placeholder="Label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="flex-1 bg-surface border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as 'movies' | 'tv')}
              className="bg-surface border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-accent"
            >
              <option value="movies">Movies</option>
              <option value="tv">TV</option>
            </select>
            <button
              onClick={add}
              disabled={busy || !newPath.trim() || !newLabel.trim()}
              className="px-3 py-1.5 text-sm rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-40 transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {!loading && roots.length === 0 && (
        <p className="text-sm text-gray-500">No scan roots configured.</p>
      )}

      <div className="space-y-2">
        {roots.map((root) => (
          <div
            key={root.id}
            className={`flex items-center gap-3 p-3 rounded-lg border ${root.enabled ? 'border-gray-700' : 'border-gray-800 opacity-60'}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-200">{root.label}</span>
                <span className="text-xs bg-gray-800 px-1.5 rounded text-gray-400">
                  {root.type === 'movies' ? 'Movies' : 'TV'}
                </span>
              </div>
              <p className="text-xs text-gray-500 font-mono truncate mt-0.5">{root.path}</p>
            </div>
            <button
              onClick={() => toggleEnabled(root)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${root.enabled ? 'text-green-400 bg-green-900/30' : 'text-gray-500 bg-gray-800'}`}
            >
              {root.enabled ? 'Enabled' : 'Disabled'}
            </button>
            <button
              onClick={() => remove(root.id)}
              disabled={busy}
              className="text-xs text-red-500 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Schedule card
// ---------------------------------------------------------------------------

function MatchBehaviorCard() {
  const [autoCleanup, setAutoCleanup] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchAutoCleanup().then(setAutoCleanup).finally(() => setLoading(false))
  }, [])

  async function toggle() {
    const next = !autoCleanup
    setSaving(true)
    try {
      await updateAutoCleanup(next)
      setAutoCleanup(next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-surface-raised border border-gray-700 rounded-lg p-5 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Match Behavior</h2>
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <button
            role="switch"
            aria-checked={autoCleanup}
            onClick={toggle}
            disabled={saving}
            className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-40 ${autoCleanup ? 'bg-accent' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoCleanup ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <div>
            <p className="text-sm text-gray-200">Auto-cleanup folder on match / re-match</p>
            <p className="text-xs text-gray-500 mt-0.5">After every match or re-match, automatically delete old TMM artwork, stale NFOs, subtitles, and unknown files — same files the Folder Cleanup panel pre-selects.</p>
          </div>
        </label>
      )}
    </div>
  )
}

const SCHEDULE_LABELS: Record<ScheduleInterval, string> = {
  disabled: 'Disabled',
  '1h': 'Every hour',
  '6h': 'Every 6 hours',
  '12h': 'Every 12 hours',
  '24h': 'Every 24 hours',
}

function ScheduleCard() {
  const [schedule, setScheduleState] = useState<ScheduleInterval>('disabled')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchSchedule()
      .then(setScheduleState)
      .finally(() => setLoading(false))
  }, [])

  async function save(val: ScheduleInterval) {
    setSaving(true)
    setSaved(false)
    try {
      await updateSchedule(val)
      setScheduleState(val)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-surface-raised border border-gray-700 rounded-lg p-5 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Scan Schedule</h2>
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SCHEDULE_LABELS) as ScheduleInterval[]).map((val) => (
            <button
              key={val}
              onClick={() => save(val)}
              disabled={saving}
              className={[
                'text-sm px-3 py-1.5 rounded border transition-colors disabled:opacity-40',
                schedule === val
                  ? 'border-accent bg-accent/20 text-accent'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500',
              ].join(' ')}
            >
              {SCHEDULE_LABELS[val]}
            </button>
          ))}
          {saved && <span className="text-xs text-green-400 self-center">Saved.</span>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scan Logs card
// ---------------------------------------------------------------------------

function ScanLogsCard() {
  const [logs, setLogs] = useState<ScanLogRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchScanLogs()
      .then(setLogs)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="bg-surface-raised border border-gray-700 rounded-lg p-5 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Recent Scans</h2>
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && logs.length === 0 && <p className="text-sm text-gray-500">No scans yet.</p>}
      <div className="space-y-2">
        {logs.map((log) => {
          const started = new Date(log.startedAt)
          const finished = log.finishedAt ? new Date(log.finishedAt) : null
          const duration = finished ? Math.round((finished.getTime() - started.getTime()) / 1000) : null
          return (
            <div key={log.id} className="text-xs text-gray-400 flex items-start justify-between gap-4 py-1 border-b border-gray-800 last:border-0">
              <span className="text-gray-500">{started.toLocaleString()}</span>
              <span className="text-gray-300">
                +{log.filesAdded} ~{log.filesChanged} -{log.filesRemoved}
                {log.staleFilesFound > 0 && ` · ${log.staleFilesFound} stale`}
              </span>
              {duration != null && <span className="text-gray-600">{duration}s</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

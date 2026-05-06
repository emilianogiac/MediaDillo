import { useState, useEffect } from 'react'
import type { JellyfinStatus } from '../api/jellyfin.js'
import { fetchJellyfinStatus, triggerJellyfinRefresh } from '../api/jellyfin.js'
import { downloadJson, downloadMoviesCsv, downloadShowsCsv, writeBulkNfo } from '../api/export.js'

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
          Scan Roots
        </h2>
        <p className="text-sm text-gray-500">
          Configure scan roots via the{' '}
          <code className="text-xs bg-gray-800 px-1 rounded">SCAN_ROOTS</code> environment
          variable. Full configuration UI coming in Epic 12.
        </p>
      </div>

      <div className="bg-surface-raised border border-gray-700 rounded-lg p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-3">
          API Keys
        </h2>
        <p className="text-sm text-gray-500">
          Set <code className="text-xs bg-gray-800 px-1 rounded">TMDB_API_KEY</code> and
          optionally <code className="text-xs bg-gray-800 px-1 rounded">TVDB_API_KEY</code>{' '}
          in your environment. Full configuration UI coming in Epic 12.
        </p>
      </div>

      <ExportCard />
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

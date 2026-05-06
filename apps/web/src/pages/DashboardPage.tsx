import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { LibraryStats } from '../api/stats.js'
import { fetchStats, formatBytes } from '../api/stats.js'
import { apiFetch } from '../api/client.js'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-surface-raised rounded-xl p-4 border border-gray-800">
      <div className="text-3xl font-bold text-accent">{value}</div>
      <div className="text-sm text-gray-400 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
    </div>
  )
}

function ScanButton() {
  const [scanning, setScanning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function trigger() {
    setScanning(true)
    setMsg(null)
    try {
      await apiFetch('/scan', { method: 'POST' })
      setMsg('Scan started.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={trigger}
        disabled={scanning}
        className="px-4 py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-40 transition-colors"
      >
        {scanning ? 'Starting…' : 'Trigger scan'}
      </button>
      {msg && <span className="text-xs text-gray-400">{msg}</span>}
    </div>
  )
}

function LastScanCard({ scan }: { scan: NonNullable<LibraryStats['lastScan']> }) {
  const started = new Date(scan.startedAt)
  const finished = scan.finishedAt ? new Date(scan.finishedAt) : null
  const duration = finished
    ? Math.round((finished.getTime() - started.getTime()) / 1000)
    : null

  return (
    <div className="bg-surface-raised border border-gray-700 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-gray-400 mb-3">Last Scan</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        {[
          { label: 'Added', value: scan.filesAdded },
          { label: 'Changed', value: scan.filesChanged },
          { label: 'Removed', value: scan.filesRemoved },
          { label: 'Stale', value: scan.staleFilesFound },
        ].map(({ label, value }) => (
          <div key={label} className="space-y-0.5">
            <div className="text-xl font-bold text-gray-200">{value}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-600 mt-3">
        {started.toLocaleString()}
        {duration != null && ` — ${duration}s`}
      </p>
    </div>
  )
}

export function DashboardPage() {
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  const storage = stats ? formatBytes(stats.storageBytesStr) : '—'

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <ScanButton />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Movies" value={loading ? '…' : (stats?.movies ?? 0)} />
        <StatCard label="TV Shows" value={loading ? '…' : (stats?.shows ?? 0)} />
        <StatCard label="Episodes" value={loading ? '…' : (stats?.episodesOwned ?? 0)} />
        <StatCard label="Storage" value={loading ? '…' : storage} />
      </div>

      {/* Health + missing */}
      {stats && (stats.healthIssues > 0 || stats.unmatched > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {stats.missingArt > 0 && (
            <Link
              to="/health?missingArtwork=true"
              className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-4 hover:border-yellow-600/60 transition-colors"
            >
              <div className="text-xl font-bold text-yellow-400">{stats.missingArt}</div>
              <div className="text-sm text-yellow-600 mt-0.5">Items missing artwork</div>
              <div className="text-xs text-gray-500 mt-1">Go to Health →</div>
            </Link>
          )}
          {stats.unmatched > 0 && (
            <Link
              to="/health?unmatched=true"
              className="bg-red-900/20 border border-red-700/40 rounded-lg p-4 hover:border-red-600/60 transition-colors"
            >
              <div className="text-xl font-bold text-red-400">{stats.unmatched}</div>
              <div className="text-sm text-red-600 mt-0.5">Unmatched items</div>
              <div className="text-xs text-gray-500 mt-1">Go to Health →</div>
            </Link>
          )}
        </div>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Link
          to="/health"
          className="text-sm px-4 py-2 rounded border border-gray-700 hover:border-gray-500 text-gray-300 transition-colors"
        >
          Library Health
        </Link>
        <Link
          to="/missing"
          className="text-sm px-4 py-2 rounded border border-gray-700 hover:border-gray-500 text-gray-300 transition-colors"
        >
          Missing Content
        </Link>
        <Link
          to="/files"
          className="text-sm px-4 py-2 rounded border border-gray-700 hover:border-gray-500 text-gray-300 transition-colors"
        >
          File Manager
        </Link>
      </div>

      {/* Last scan */}
      {stats?.lastScan && <LastScanCard scan={stats.lastScan} />}

      {!loading && !stats?.lastScan && (
        <p className="text-sm text-gray-500">No scans yet. Trigger a scan to populate your library.</p>
      )}
    </div>
  )
}

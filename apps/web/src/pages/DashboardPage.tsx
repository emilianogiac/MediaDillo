import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { LibraryStats } from '../api/stats.js'
import { fetchStats, formatBytes } from '../api/stats.js'
import { apiFetch } from '../api/client.js'
import type { ScanRoot } from '../api/types.js'
import { fetchScanLogs } from '../api/settings.js'
import type { ScanLogRecord } from '../api/settings.js'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-surface-raised rounded-xl p-4 border border-gray-800">
      <div className="text-3xl font-bold text-accent">{value}</div>
      <div className="text-sm text-gray-400 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
    </div>
  )
}

interface ScanProgress {
  scanning: boolean
  filesProcessed: number
  filesFound: number
  currentFile: string | null
  startedAt: string | null
}

const LAST_SCAN_KEY = 'mediaDillo.lastScanAt'

function ScanButton() {
  const [triggered, setTriggered] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [roots, setRoots] = useState<ScanRoot[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scanStartedAtRef = useRef<string | null>(null)
  const failCountRef = useRef(0)

  useEffect(() => {
    apiFetch<ScanRoot[]>('/scan-roots')
      .then(setRoots)
      .catch(() => {})
  }, [])

  // On mount: resume progress display if a scan is already running
  useEffect(() => {
    apiFetch<ScanProgress>('/scan/progress')
      .then((p) => {
        if (p.scanning) {
          setProgress(p)
          setTriggered(true)
          pollRef.current = setInterval(() => { void pollProgress() }, 2000)
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleRoot(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  async function pollProgress() {
    try {
      const p = await apiFetch<ScanProgress>('/scan/progress')
      failCountRef.current = 0
      setProgress(p)
      if (!p.scanning) {
        stopPolling()
        setTriggered(false)
        setMsg(`Scan complete — ${p.filesProcessed} files processed`)
        const startedAt = scanStartedAtRef.current ?? p.startedAt
        if (startedAt) {
          localStorage.setItem(LAST_SCAN_KEY, startedAt)
          scanStartedAtRef.current = null
        }
      }
    } catch {
      failCountRef.current += 1
      if (failCountRef.current >= 3) {
        stopPolling()
        setTriggered(false)
        setMsg('Server unreachable — scan status unknown')
      }
    }
  }

  async function trigger() {
    setTriggered(true)
    setMsg(null)
    setProgress(null)
    failCountRef.current = 0
    const rootIds = selectedIds.size > 0 ? [...selectedIds] : null
    try {
      const scanRes = await apiFetch<{ startedAt: string }>('/scan', {
        method: 'POST',
        ...(rootIds ? { body: JSON.stringify({ rootIds }) } : {}),
      })
      scanStartedAtRef.current = scanRes.startedAt
      pollRef.current = setInterval(() => { void pollProgress() }, 2000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed'
      if (msg.includes('already in progress') || msg.includes('409')) {
        // Scan already running — reconnect to it silently
        pollRef.current = setInterval(() => { void pollProgress() }, 2000)
      } else {
        setMsg(msg)
        setTriggered(false)
      }
    }
  }

  // Cleanup on unmount
  useEffect(() => () => { stopPolling() }, [])

  const isScanning = triggered || progress?.scanning
  const allSelected = selectedIds.size === 0
  const scanLabel = allSelected
    ? 'Scan all'
    : `Scan ${selectedIds.size} root${selectedIds.size > 1 ? 's' : ''}`

  return (
    <div className="flex flex-col gap-2 items-end">
      {/* Root selector — split by type */}
      {roots.length > 1 && (() => {
        const movieRoots = roots.filter((r) => r.type === 'movies')
        const tvRoots = roots.filter((r) => r.type === 'tv')
        const renderRow = (group: typeof roots, rowLabel: string) =>
          group.length > 0 && (
            <div key={rowLabel} className="flex items-center gap-1.5 justify-end">
              <span className="text-xs text-gray-600 shrink-0">{rowLabel}</span>
              {group.map((r) => {
                const active = selectedIds.has(r.id)
                return (
                  <button
                    key={r.id}
                    onClick={() => toggleRoot(r.id)}
                    disabled={!!isScanning}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors disabled:opacity-40 ${
                      active
                        ? 'border-accent bg-accent/20 text-accent'
                        : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>
          )
        return (
          <div className="flex flex-col gap-1">
            {renderRow(movieRoots, 'Movies')}
            {renderRow(tvRoots, 'TV')}
          </div>
        )
      })()}

      <div className="flex items-center gap-3">
        <button
          onClick={trigger}
          disabled={!!isScanning}
          className="px-4 py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-40 transition-colors"
        >
          {isScanning ? 'Scanning…' : scanLabel}
        </button>
        {msg && !isScanning && <span className="text-xs text-gray-400">{msg}</span>}
      </div>

      {progress?.scanning && (
        <div className="text-xs text-gray-400 text-right max-w-xs">
          <span className="font-medium text-accent">{progress.filesProcessed.toLocaleString()}</span>
          {progress.filesFound > 0 && (
            <> / {progress.filesFound.toLocaleString()} files</>
          )}
          {progress.currentFile && (
            <div className="text-gray-600 truncate max-w-[240px]" title={progress.currentFile}>
              {progress.currentFile.split('/').slice(-2).join('/')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ScanHistoryCard() {
  const [logs, setLogs] = useState<ScanLogRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchScanLogs(10).then(setLogs).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="bg-surface-raised border border-gray-700 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-gray-400 mb-3">Scan History</h2>
      <p className="text-sm text-gray-500">Loading…</p>
    </div>
  )

  if (logs.length === 0) return null

  const latest = logs[0]!
  const rest = logs.slice(1)

  function duration(log: ScanLogRecord) {
    if (!log.finishedAt) return null
    return Math.round((new Date(log.finishedAt).getTime() - new Date(log.startedAt).getTime()) / 1000)
  }

  return (
    <div className="bg-surface-raised border border-gray-700 rounded-lg p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-400">Scan History</h2>

      {/* Latest scan — prominent stats */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500">
          {new Date(latest.startedAt).toLocaleString()}
          {duration(latest) != null && ` — ${duration(latest)}s`}
        </p>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Added', value: latest.filesAdded, color: 'text-green-400' },
            { label: 'Changed', value: latest.filesChanged, color: 'text-blue-400' },
            { label: 'Removed', value: latest.filesRemoved, color: 'text-red-400' },
            { label: 'Stale', value: latest.staleFilesFound, color: 'text-yellow-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="space-y-0.5">
              <div className={`text-xl font-bold ${value > 0 ? color : 'text-gray-600'}`}>{value}</div>
              <div className="text-xs text-gray-500">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Older scans — compact rows */}
      {rest.length > 0 && (
        <div className="space-y-1 border-t border-gray-800 pt-3">
          {rest.map((log) => {
            const dur = duration(log)
            const hasActivity = log.filesAdded > 0 || log.filesChanged > 0 || log.filesRemoved > 0
            return (
              <div key={log.id} className="flex items-center justify-between text-xs text-gray-500 py-0.5">
                <span>{new Date(log.startedAt).toLocaleString()}</span>
                <span className={hasActivity ? 'text-gray-300' : ''}>
                  {hasActivity
                    ? `+${log.filesAdded} ~${log.filesChanged} -${log.filesRemoved}${log.staleFilesFound > 0 ? ` · ${log.staleFilesFound} stale` : ''}`
                    : 'no changes'}
                </span>
                {dur != null && <span className="text-gray-600 w-10 text-right">{dur}s</span>}
              </div>
            )
          })}
        </div>
      )}
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
      <ScanHistoryCard />
    </div>
  )
}

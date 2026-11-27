import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from './DashboardPage.js'

// Spread the original: a bare factory replaces the whole module, so any export the
// page picks up later is undefined and throws inside an effect (issue #98).
vi.mock('../api/stats.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/stats.js')>()),
  fetchStats: vi.fn(),
  formatBytes: vi.fn((s: string) => `${s} B`),
}))

vi.mock('../api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client.js')>()),
  apiFetch: vi.fn(),
}))

import { fetchStats } from '../api/stats.js'
import { apiFetch } from '../api/client.js'

const mockFetchStats = fetchStats as ReturnType<typeof vi.fn>
const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>

const makeStats = (overrides = {}) => ({
  movies: 120,
  shows: 15,
  episodesOwned: 450,
  storageBytesStr: '1000000000',
  healthIssues: 3,
  missingArt: 2,
  unmatched: 1,
  lastScan: {
    id: 'scan-1',
    startedAt: '2026-05-05T10:00:00Z',
    finishedAt: '2026-05-05T10:02:30Z',
    filesAdded: 5,
    filesChanged: 2,
    filesRemoved: 0,
    staleFilesFound: 1,
  },
  ...overrides,
})

const makeScanLog = (overrides = {}) => ({
  id: 'scan-1',
  startedAt: '2026-05-05T10:00:00Z',
  finishedAt: '2026-05-05T10:02:30Z',
  filesAdded: 5,
  filesChanged: 2,
  filesRemoved: 0,
  staleFilesFound: 1,
  ...overrides,
})

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // Every endpoint the page reaches has to be routed here: api/settings.js goes
  // through this same apiFetch, so the fallback used to hand ScanHistoryCard a
  // `{ message }` object where it expected an array of logs, and it threw on
  // `logs.slice` before any assertion ran (issue #98).
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/scan-roots') return Promise.resolve([])
    if (path.startsWith('/settings/scan-logs')) return Promise.resolve([])
    return Promise.resolve({ message: 'Scan started' })
  })
})

describe('DashboardPage', () => {
  it('renders heading and trigger scan button', () => {
    mockFetchStats.mockResolvedValue(makeStats())
    renderPage()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Scan all')).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    mockFetchStats.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getAllByText('…').length).toBeGreaterThan(0)
  })

  it('renders stats after load', async () => {
    mockFetchStats.mockResolvedValue(makeStats())
    renderPage()
    await waitFor(() => expect(screen.getByText('120')).toBeInTheDocument())
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('450')).toBeInTheDocument()
  })

  it('shows health issue cards when there are issues', async () => {
    mockFetchStats.mockResolvedValue(makeStats())
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('Items missing artwork')).toBeInTheDocument(),
    )
    expect(screen.getByText('Unmatched items')).toBeInTheDocument()
  })

  it('hides health cards when library is healthy', async () => {
    mockFetchStats.mockResolvedValue(makeStats({ missingArt: 0, unmatched: 0, healthIssues: 0 }))
    renderPage()
    await waitFor(() => expect(screen.getByText('120')).toBeInTheDocument())
    expect(screen.queryByText('Items missing artwork')).not.toBeInTheDocument()
  })

  // The single "Last Scan" card became ScanHistoryCard, which reads the scan log
  // endpoint rather than `stats.lastScan` and renders nothing at all when there are no
  // scans. These two tests follow the component (issue #98).
  it('shows the latest scan figures from the scan log', async () => {
    mockFetchStats.mockResolvedValue(makeStats())
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/scan-roots') return Promise.resolve([])
      if (path.startsWith('/settings/scan-logs')) return Promise.resolve([makeScanLog()])
      return Promise.resolve({ message: 'Scan started' })
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Scan History')).toBeInTheDocument())
    for (const label of ['Added', 'Changed', 'Removed', 'Stale']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders no scan history card when there are no scans', async () => {
    mockFetchStats.mockResolvedValue(makeStats({ lastScan: null }))
    renderPage()
    await waitFor(() => expect(screen.getByText('120')).toBeInTheDocument())
    expect(screen.queryByText('Scan History')).not.toBeInTheDocument()
  })

  it('triggers scan when button is clicked and shows scanning state', async () => {
    // apiFetch never resolves — keeps button in "Scanning…" state
    mockFetchStats.mockResolvedValue(makeStats())
    mockApiFetch.mockReturnValue(new Promise(() => {}))
    renderPage()
    fireEvent.click(screen.getByText('Scan all'))
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/scan', expect.objectContaining({ method: 'POST' })))
    expect(screen.getByText('Scanning…')).toBeInTheDocument()
  })
})

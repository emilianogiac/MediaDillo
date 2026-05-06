import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from './DashboardPage.js'

vi.mock('../api/stats.js', () => ({
  fetchStats: vi.fn(),
  formatBytes: vi.fn((s: string) => `${s} B`),
}))

vi.mock('../api/client.js', () => ({
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

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApiFetch.mockResolvedValue({ message: 'Scan started' })
})

describe('DashboardPage', () => {
  it('renders heading and trigger scan button', () => {
    mockFetchStats.mockResolvedValue(makeStats())
    renderPage()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Trigger scan')).toBeInTheDocument()
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

  it('shows last scan details', async () => {
    mockFetchStats.mockResolvedValue(makeStats())
    renderPage()
    await waitFor(() => expect(screen.getByText('Last Scan')).toBeInTheDocument())
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('shows no-scan message when lastScan is null', async () => {
    mockFetchStats.mockResolvedValue(makeStats({ lastScan: null }))
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/No scans yet/)).toBeInTheDocument(),
    )
  })

  it('triggers scan when button is clicked', async () => {
    mockFetchStats.mockResolvedValue(makeStats())
    renderPage()
    fireEvent.click(screen.getByText('Trigger scan'))
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/scan', expect.objectContaining({ method: 'POST' })))
    expect(screen.getByText('Scan started.')).toBeInTheDocument()
  })
})

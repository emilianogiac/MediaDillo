import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SettingsPage } from './SettingsPage.js'

vi.mock('../api/jellyfin.js', () => ({
  fetchJellyfinStatus: vi.fn(),
  triggerJellyfinRefresh: vi.fn(),
}))

vi.mock('../api/export.js', () => ({
  downloadJson: vi.fn(),
  downloadMoviesCsv: vi.fn(),
  downloadShowsCsv: vi.fn(),
  writeBulkNfo: vi.fn(),
}))

import { fetchJellyfinStatus, triggerJellyfinRefresh } from '../api/jellyfin.js'
import { downloadJson, writeBulkNfo } from '../api/export.js'

const mockStatus = fetchJellyfinStatus as ReturnType<typeof vi.fn>
const mockRefresh = triggerJellyfinRefresh as ReturnType<typeof vi.fn>
const mockDownloadJson = downloadJson as ReturnType<typeof vi.fn>
const mockBulkNfo = writeBulkNfo as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockRefresh.mockResolvedValue(undefined)
  mockDownloadJson.mockReturnValue(undefined)
  mockBulkNfo.mockResolvedValue({ movies: 3, shows: 1, errors: [] })
})

describe('SettingsPage', () => {
  it('renders heading and sections', async () => {
    mockStatus.mockResolvedValue({ configured: false, connected: false })
    render(<SettingsPage />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Jellyfin')).toBeInTheDocument()
    expect(screen.getByText('Scan Roots')).toBeInTheDocument()
    expect(screen.getByText('API Keys')).toBeInTheDocument()
  })

  it('shows not configured state', async () => {
    mockStatus.mockResolvedValue({ configured: false, connected: false })
    render(<SettingsPage />)
    await waitFor(() =>
      expect(screen.getByText(/Not configured/)).toBeInTheDocument(),
    )
  })

  it('shows connected state with server name', async () => {
    mockStatus.mockResolvedValue({
      configured: true,
      connected: true,
      serverName: 'My Jellyfin',
      version: '10.9.1',
    })
    render(<SettingsPage />)
    await waitFor(() =>
      expect(screen.getByText(/Connected — My Jellyfin v10\.9\.1/)).toBeInTheDocument(),
    )
    expect(screen.getByText('Trigger library refresh')).toBeInTheDocument()
  })

  it('shows disconnected state with error', async () => {
    mockStatus.mockResolvedValue({
      configured: true,
      connected: false,
      error: 'ECONNREFUSED',
    })
    render(<SettingsPage />)
    await waitFor(() =>
      expect(screen.getByText(/Not reachable — ECONNREFUSED/)).toBeInTheDocument(),
    )
  })

  it('shows export and NFO section', async () => {
    mockStatus.mockResolvedValue({ configured: false, connected: false })
    render(<SettingsPage />)
    expect(screen.getByText('Export & NFO')).toBeInTheDocument()
    expect(screen.getByText('Export JSON')).toBeInTheDocument()
    expect(screen.getByText('Movies CSV')).toBeInTheDocument()
    expect(screen.getByText('Shows CSV')).toBeInTheDocument()
    expect(screen.getByText('Write all NFO files')).toBeInTheDocument()
  })

  it('calls downloadJson when Export JSON is clicked', async () => {
    mockStatus.mockResolvedValue({ configured: false, connected: false })
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('Export JSON'))
    expect(mockDownloadJson).toHaveBeenCalled()
  })

  it('writes bulk NFO and shows result', async () => {
    mockStatus.mockResolvedValue({ configured: false, connected: false })
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('Write all NFO files'))
    await waitFor(() =>
      expect(screen.getByText(/Written: 3 movie NFOs, 1 show NFO/)).toBeInTheDocument(),
    )
  })

  it('triggers manual refresh', async () => {
    mockStatus.mockResolvedValue({ configured: true, connected: true, serverName: 'Jf', version: '10' })
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByText('Trigger library refresh')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Trigger library refresh'))
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
    expect(screen.getByText('Library refresh triggered.')).toBeInTheDocument()
  })
})

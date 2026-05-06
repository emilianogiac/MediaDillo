import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SettingsPage } from './SettingsPage.js'

vi.mock('../api/jellyfin.js', () => ({
  fetchJellyfinStatus: vi.fn(),
  triggerJellyfinRefresh: vi.fn(),
}))

import { fetchJellyfinStatus, triggerJellyfinRefresh } from '../api/jellyfin.js'

const mockStatus = fetchJellyfinStatus as ReturnType<typeof vi.fn>
const mockRefresh = triggerJellyfinRefresh as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockRefresh.mockResolvedValue(undefined)
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

  it('triggers manual refresh', async () => {
    mockStatus.mockResolvedValue({ configured: true, connected: true, serverName: 'Jf', version: '10' })
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByText('Trigger library refresh')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Trigger library refresh'))
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
    expect(screen.getByText('Library refresh triggered.')).toBeInTheDocument()
  })
})

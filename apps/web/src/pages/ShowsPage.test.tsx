import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ShowsPage } from './ShowsPage.js'
import { ToastProvider } from '../context/ToastContext.js'

// Spread the original: a bare factory replaces the whole module, so any export the
// page picks up later is undefined and throws inside an effect (issue #98).
vi.mock('../api/shows.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/shows.js')>()),
  fetchShows: vi.fn(),
}))
vi.mock('../api/movies.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/movies.js')>()),
  fetchScanRoots: vi.fn(),
}))

import { fetchShows } from '../api/shows.js'
import { fetchScanRoots } from '../api/movies.js'

const mockFetchShows = fetchShows as ReturnType<typeof vi.fn>
// Fetched on mount; unstubbed it reaches the real module and attempts a network call.
const mockFetchScanRoots = fetchScanRoots as ReturnType<typeof vi.fn>

const makeShow = (overrides = {}) => ({
  id: 'show-1',
  title: 'Breaking Bad',
  year: 2008,
  posterUrl: null,
  genres: ['Drama', 'Crime'],
  rating: 9.5,
  tmdbId: 1396,
  posterDownloaded: true,
  backdropDownloaded: true,
  status: 'ended' as const,
  ownedEpisodes: 62,
  totalEpisodes: 62,
  // Required: the page explodes a show into one entry per scan root, so a missing
  // array throws in a useMemo before any assertion runs (issue #98).
  scanRoots: [{ id: 'root-1', label: 'serie_tv' }],
  ...overrides,
})

// The page calls useToast, which throws outside a provider.
function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <ShowsPage />
      </MemoryRouter>
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchScanRoots.mockResolvedValue([])
})

describe('ShowsPage', () => {
  it('shows loading state initially', () => {
    // The page replaced the "Loading…" text with skeleton cards, so the assertion
    // followed the component rather than the component being reverted (issue #98).
    mockFetchShows.mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.getByText('…')).toBeInTheDocument()
  })

  it('renders show cards after load', async () => {
    mockFetchShows.mockResolvedValue([
      makeShow(),
      makeShow({ id: 'show-2', title: 'The Wire' }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('Breaking Bad')).toBeInTheDocument())
    expect(screen.getByText('The Wire')).toBeInTheDocument()
    expect(screen.getByText('2 shows')).toBeInTheDocument()
  })

  it('shows episode completeness bar', async () => {
    mockFetchShows.mockResolvedValue([makeShow({ ownedEpisodes: 30, totalEpisodes: 62 })])
    renderPage()
    await waitFor(() => expect(screen.getByText('30/62 ep')).toBeInTheDocument())
  })

  it('shows 100% complete correctly', async () => {
    mockFetchShows.mockResolvedValue([makeShow()])
    renderPage()
    await waitFor(() => expect(screen.getByText('62/62 ep')).toBeInTheDocument())
  })

  it('shows Airing badge for continuing show', async () => {
    mockFetchShows.mockResolvedValue([makeShow({ status: 'continuing' })])
    renderPage()
    await waitFor(() => expect(screen.getByText('Airing')).toBeInTheDocument())
  })

  it('shows Unmatched badge on shows without tmdbId', async () => {
    mockFetchShows.mockResolvedValue([makeShow({ tmdbId: null })])
    renderPage()
    await waitFor(() => expect(screen.getByText('Unmatched')).toBeInTheDocument())
  })

  it('shows Art missing badge when artwork not downloaded', async () => {
    mockFetchShows.mockResolvedValue([makeShow({ posterDownloaded: false })])
    renderPage()
    await waitFor(() => expect(screen.getByText('Art missing')).toBeInTheDocument())
  })

  it('shows error message on fetch failure', async () => {
    mockFetchShows.mockRejectedValue(new Error('Network error'))
    renderPage()
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument())
  })

  it('shows empty state when no shows', async () => {
    mockFetchShows.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(screen.getByText('No shows found.')).toBeInTheDocument())
  })

  it('search filter triggers refetch', async () => {
    mockFetchShows.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(screen.getByPlaceholderText('Search shows…')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Search shows…'), {
      target: { value: 'breaking' },
    })
    await waitFor(() =>
      expect(mockFetchShows).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'breaking' }),
      ),
    )
  })
})

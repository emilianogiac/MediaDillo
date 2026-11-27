import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MoviesPage } from './MoviesPage.js'
import { ToastProvider } from '../context/ToastContext.js'

// Spread the original: a bare factory replaces the whole module, so any export the
// page picks up later is undefined and throws inside an effect (issue #98).
vi.mock('../api/movies.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/movies.js')>()),
  fetchMovies: vi.fn(),
  fetchScanRoots: vi.fn(),
  fetchEditions: vi.fn(),
}))

import { fetchMovies, fetchScanRoots, fetchEditions } from '../api/movies.js'

const mockFetchMovies = fetchMovies as ReturnType<typeof vi.fn>
const mockFetchScanRoots = fetchScanRoots as ReturnType<typeof vi.fn>
// Fetched on mount; unstubbed it reaches the real module and attempts a network call.
const mockFetchEditions = fetchEditions as ReturnType<typeof vi.fn>

const makeMovie = (overrides = {}) => ({
  id: 'movie-1',
  title: 'Inception',
  year: 2010,
  posterUrl: null,
  genres: ['Sci-Fi', 'Action'],
  rating: 8.8,
  runtime: 148,
  tmdbId: 27205,
  posterDownloaded: true,
  backdropDownloaded: true,
  status: 'owned',
  scanRoot: { id: 'root-1', label: 'Films' },
  files: [{ videoQualityTier: '1080p' }],
  ...overrides,
})

// The page calls useToast, which throws outside a provider.
function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <MoviesPage />
      </MemoryRouter>
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchScanRoots.mockResolvedValue([])
  mockFetchEditions.mockResolvedValue([])
})

describe('MoviesPage', () => {
  it('shows loading state initially', () => {
    // The page replaced the "Loading…" text with skeleton cards, so the assertion
    // followed the component rather than the component being reverted (issue #98).
    mockFetchMovies.mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.getByText('…')).toBeInTheDocument()
  })

  it('renders movie cards after load', async () => {
    mockFetchMovies.mockResolvedValue([makeMovie(), makeMovie({ id: 'movie-2', title: 'The Matrix' })])
    renderPage()
    await waitFor(() => expect(screen.getByText('Inception')).toBeInTheDocument())
    expect(screen.getByText('The Matrix')).toBeInTheDocument()
    expect(screen.getByText('2 titles')).toBeInTheDocument()
  })

  it('shows error message on fetch failure', async () => {
    mockFetchMovies.mockRejectedValue(new Error('Network error'))
    renderPage()
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument())
  })

  it('shows empty state when no movies', async () => {
    mockFetchMovies.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(screen.getByText('No movies found.')).toBeInTheDocument())
  })

  it('renders category tabs for movie scan roots', async () => {
    mockFetchScanRoots.mockResolvedValue([
      { id: 'root-1', label: 'Films', type: 'movies', path: '/mnt/film' },
      { id: 'root-2', label: '4K Films', type: 'movies', path: '/mnt/film_4k' },
      { id: 'root-tv', label: 'TV Shows', type: 'tv', path: '/mnt/tv' }, // should be excluded
    ])
    mockFetchMovies.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(screen.getByText('Films')).toBeInTheDocument())
    expect(screen.getByText('4K Films')).toBeInTheDocument()
    expect(screen.queryByText('TV Shows')).not.toBeInTheDocument()
  })

  it('clicking a category tab re-fetches with scanRootId', async () => {
    mockFetchScanRoots.mockResolvedValue([
      { id: 'root-1', label: 'Films', type: 'movies', path: '/mnt/film' },
    ])
    mockFetchMovies.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(screen.getByText('Films')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Films'))
    await waitFor(() =>
      expect(mockFetchMovies).toHaveBeenLastCalledWith(
        expect.objectContaining({ scanRootId: 'root-1' }),
      ),
    )
  })

  it('shows unmatched badge on cards without tmdbId', async () => {
    mockFetchMovies.mockResolvedValue([makeMovie({ tmdbId: null })])
    renderPage()
    await waitFor(() => expect(screen.getByText('Unmatched')).toBeInTheDocument())
  })

  it('shows art missing badge when artwork not downloaded', async () => {
    mockFetchMovies.mockResolvedValue([makeMovie({ posterDownloaded: false })])
    renderPage()
    await waitFor(() => expect(screen.getByText('Art missing')).toBeInTheDocument())
  })
})

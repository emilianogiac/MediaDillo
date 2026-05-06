import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ShowsPage } from './ShowsPage.js'

vi.mock('../api/shows.js', () => ({
  fetchShows: vi.fn(),
}))

import { fetchShows } from '../api/shows.js'

const mockFetchShows = fetchShows as ReturnType<typeof vi.fn>

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
  ...overrides,
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ShowsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ShowsPage', () => {
  it('shows loading state initially', () => {
    mockFetchShows.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
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

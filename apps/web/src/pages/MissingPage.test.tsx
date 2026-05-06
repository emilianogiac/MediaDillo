import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MissingPage } from './MissingPage.js'

vi.mock('../api/missing.js', () => ({
  fetchMissingShows: vi.fn(),
  fetchWantedMovies: vi.fn(),
  addWantedMovie: vi.fn(),
  removeWantedMovie: vi.fn(),
  searchMoviesForWishlist: vi.fn(),
}))

import {
  fetchMissingShows,
  fetchWantedMovies,
  removeWantedMovie,
  searchMoviesForWishlist,
  addWantedMovie,
} from '../api/missing.js'

const mockFetchShows = fetchMissingShows as ReturnType<typeof vi.fn>
const mockFetchMovies = fetchWantedMovies as ReturnType<typeof vi.fn>
const mockRemove = removeWantedMovie as ReturnType<typeof vi.fn>
const mockSearch = searchMoviesForWishlist as ReturnType<typeof vi.fn>
const mockAdd = addWantedMovie as ReturnType<typeof vi.fn>

const makeShow = (overrides = {}) => ({
  id: 'show-1',
  title: 'Breaking Bad',
  year: 2008,
  posterUrl: null,
  ownedEpisodes: 50,
  totalEpisodes: 62,
  showStatus: 'ended' as const,
  missingCount: 12,
  ...overrides,
})

const makeWanted = (overrides = {}) => ({
  id: 'movie-1',
  title: 'Dune',
  year: 2021,
  posterUrl: null,
  overview: 'A noble family becomes embroiled in a war.',
  rating: 8.0,
  genres: ['Sci-Fi'],
  tmdbId: 438631,
  imdbId: null,
  ...overrides,
})

function renderPage() {
  return render(
    <MemoryRouter>
      <MissingPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchShows.mockResolvedValue([])
  mockFetchMovies.mockResolvedValue([])
})

describe('MissingPage', () => {
  it('renders page heading and tabs', async () => {
    renderPage()
    expect(screen.getByText('Missing Content')).toBeInTheDocument()
    expect(screen.getByText('TV Shows')).toBeInTheDocument()
    expect(screen.getByText('Movie Wishlist')).toBeInTheDocument()
  })

  describe('TV Shows tab', () => {
    it('shows loading state', () => {
      mockFetchShows.mockReturnValue(new Promise(() => {}))
      renderPage()
      expect(screen.getByText('Loading…')).toBeInTheDocument()
    })

    it('renders show with missing count and progress', async () => {
      mockFetchShows.mockResolvedValue([makeShow()])
      renderPage()
      await waitFor(() => expect(screen.getByText('Breaking Bad')).toBeInTheDocument())
      expect(screen.getByText('12 missing')).toBeInTheDocument()
      expect(screen.getByText('50/62 (81%)')).toBeInTheDocument()
    })

    it('shows empty state when no shows', async () => {
      renderPage()
      await waitFor(() =>
        expect(screen.getByText('No missing episodes found.')).toBeInTheDocument(),
      )
    })

    it('shows show count after load', async () => {
      mockFetchShows.mockResolvedValue([makeShow(), makeShow({ id: 'show-2', title: 'The Wire' })])
      renderPage()
      await waitFor(() => expect(screen.getByText('2 shows')).toBeInTheDocument())
    })

    it('shows Airing badge for continuing show', async () => {
      mockFetchShows.mockResolvedValue([makeShow({ showStatus: 'continuing' })])
      renderPage()
      await waitFor(() => expect(screen.getByText('Airing')).toBeInTheDocument())
    })

    it('sorts by missing count by default', async () => {
      mockFetchShows.mockResolvedValue([
        makeShow({ title: 'ZShow', missingCount: 1 }),
        makeShow({ id: 'show-2', title: 'AShow', missingCount: 20 }),
      ])
      renderPage()
      await waitFor(() => {
        const items = screen.getAllByRole('link')
        const titles = items.map((el) => el.textContent)
        const aIdx = titles.findIndex((t) => t?.includes('AShow'))
        const zIdx = titles.findIndex((t) => t?.includes('ZShow'))
        expect(aIdx).toBeLessThan(zIdx)
      })
    })
  })

  describe('Movie Wishlist tab', () => {
    function switchToWishlist() {
      fireEvent.click(screen.getByText('Movie Wishlist'))
    }

    it('renders wanted movies as cards', async () => {
      mockFetchMovies.mockResolvedValue([makeWanted()])
      renderPage()
      switchToWishlist()
      await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument())
      expect(screen.getByText('1 movies in wishlist')).toBeInTheDocument()
    })

    it('shows empty state', async () => {
      renderPage()
      switchToWishlist()
      await waitFor(() =>
        expect(screen.getByText('Wishlist is empty. Add movies you want to track.')).toBeInTheDocument(),
      )
    })

    it('removes a movie when ✕ is clicked', async () => {
      mockFetchMovies.mockResolvedValue([makeWanted()])
      mockRemove.mockResolvedValue(undefined)
      renderPage()
      switchToWishlist()
      await waitFor(() => expect(screen.getByTitle('Remove from wishlist')).toBeInTheDocument())
      fireEvent.click(screen.getByTitle('Remove from wishlist'))
      await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('movie-1'))
    })

    it('opens search panel when Add movie is clicked', async () => {
      renderPage()
      switchToWishlist()
      await waitFor(() => expect(screen.getByText('+ Add movie')).toBeInTheDocument())
      fireEvent.click(screen.getByText('+ Add movie'))
      expect(screen.getByPlaceholderText('Movie title…')).toBeInTheDocument()
    })

    it('searches TMDB and shows results', async () => {
      mockSearch.mockResolvedValue([
        { tmdbId: 438631, title: 'Dune', year: 2021, overview: null, posterUrl: null, score: 0.9 },
      ])
      renderPage()
      switchToWishlist()
      await waitFor(() => fireEvent.click(screen.getByText('+ Add movie')))
      fireEvent.change(screen.getByPlaceholderText('Movie title…'), { target: { value: 'Dune' } })
      fireEvent.click(screen.getByText('Search'))
      await waitFor(() => expect(screen.getByText('Add')).toBeInTheDocument())
      expect(mockSearch).toHaveBeenCalledWith('Dune')
    })

    it('adds movie to wishlist from search results', async () => {
      mockSearch.mockResolvedValue([
        { tmdbId: 438631, title: 'Dune', year: 2021, overview: null, posterUrl: null, score: 0.9 },
      ])
      mockAdd.mockResolvedValue(makeWanted())
      mockFetchMovies.mockResolvedValue([makeWanted()])
      renderPage()
      switchToWishlist()
      await waitFor(() => fireEvent.click(screen.getByText('+ Add movie')))
      fireEvent.change(screen.getByPlaceholderText('Movie title…'), { target: { value: 'Dune' } })
      fireEvent.click(screen.getByText('Search'))
      await waitFor(() => expect(screen.getByText('Add')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Add'))
      await waitFor(() => expect(mockAdd).toHaveBeenCalled())
    })
  })
})

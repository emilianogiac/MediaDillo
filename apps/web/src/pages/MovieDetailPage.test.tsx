import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MovieDetailPage } from './MovieDetailPage.js'

vi.mock('../api/movies.js', () => ({
  fetchMovie: vi.fn(),
  triggerMovieDownload: vi.fn(),
  fetchMovieImages: vi.fn(),
  selectMovieImage: vi.fn(),
}))

import { fetchMovie } from '../api/movies.js'

const mockFetchMovie = fetchMovie as ReturnType<typeof vi.fn>

const makeDetail = (overrides = {}) => ({
  id: 'movie-1',
  title: 'Inception',
  year: 2010,
  tagline: 'Your mind is the scene of the crime.',
  overview: 'A thief who steals corporate secrets.',
  posterUrl: null,
  backdropUrl: null,
  genres: ['Action', 'Sci-Fi'],
  rating: 8.8,
  runtime: 148,
  tmdbId: 27205,
  imdbId: 'tt1375666',
  posterDownloaded: true,
  backdropDownloaded: true,
  status: 'owned',
  scanRoot: { id: 'root-1', label: 'Films', path: '/mnt/film' },
  files: [
    {
      id: 'file-1',
      path: '/mnt/film/Inception (2010)/Inception (2010).mkv',
      sizeBytes: 10_737_418_240,
      durationS: 8880,
      videoCodec: 'H.264',
      videoResolution: '1080p',
      videoQualityTier: '1080p',
      hdr: false,
      audioCodec: 'DTS',
      audioChannels: '5.1',
      audioQualityTier: 'HD',
    },
  ],
  credits: [
    { id: 'c1', role: 'director' as const, character: null, person: { id: 'p1', name: 'Christopher Nolan', profileUrl: null } },
    { id: 'c2', role: 'cast' as const, character: 'Cobb', person: { id: 'p2', name: 'Leonardo DiCaprio', profileUrl: null } },
  ],
  ...overrides,
})

function renderPage(movieId = 'movie-1') {
  return render(
    <MemoryRouter initialEntries={[`/movies/${movieId}`]}>
      <Routes>
        <Route path="/movies/:id" element={<MovieDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MovieDetailPage', () => {
  it('shows loading state', () => {
    mockFetchMovie.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders movie title, tagline and overview', async () => {
    mockFetchMovie.mockResolvedValue(makeDetail())
    renderPage()
    await waitFor(() => expect(screen.getByText('Inception')).toBeInTheDocument())
    expect(screen.getByText('Your mind is the scene of the crime.')).toBeInTheDocument()
    expect(screen.getByText('A thief who steals corporate secrets.')).toBeInTheDocument()
  })

  it('renders director and cast', async () => {
    mockFetchMovie.mockResolvedValue(makeDetail())
    renderPage()
    await waitFor(() => expect(screen.getByText('Christopher Nolan')).toBeInTheDocument())
    expect(screen.getByText('Leonardo DiCaprio')).toBeInTheDocument()
  })

  it('renders file tech badges', async () => {
    mockFetchMovie.mockResolvedValue(makeDetail())
    renderPage()
    await waitFor(() => expect(screen.getByText('H.264')).toBeInTheDocument())
    expect(screen.getByText('DTS')).toBeInTheDocument()
    expect(screen.getByText('5.1')).toBeInTheDocument()
    expect(screen.getAllByText('1080p').length).toBeGreaterThan(0)
  })

  it('renders file size and duration', async () => {
    mockFetchMovie.mockResolvedValue(makeDetail())
    renderPage()
    await waitFor(() => expect(screen.getByText(/10\.00 GB/)).toBeInTheDocument())
    expect(screen.getByText(/2h 28m/)).toBeInTheDocument()
  })

  it('shows error state with back link', async () => {
    mockFetchMovie.mockRejectedValue(new Error('Not found'))
    renderPage()
    await waitFor(() => expect(screen.getByText('Not found')).toBeInTheDocument())
    expect(screen.getByText('← Back to Movies')).toBeInTheDocument()
  })

  it('renders genres as pills', async () => {
    mockFetchMovie.mockResolvedValue(makeDetail())
    renderPage()
    await waitFor(() => expect(screen.getByText('Action')).toBeInTheDocument())
    expect(screen.getByText('Sci-Fi')).toBeInTheDocument()
  })

  it('shows artwork manager section', async () => {
    mockFetchMovie.mockResolvedValue(makeDetail())
    renderPage()
    await waitFor(() => expect(screen.getByText('Artwork')).toBeInTheDocument())
  })
})

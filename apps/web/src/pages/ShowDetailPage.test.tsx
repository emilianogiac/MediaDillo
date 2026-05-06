import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ShowDetailPage } from './ShowDetailPage.js'

vi.mock('../api/shows.js', () => ({
  fetchShow: vi.fn(),
  triggerShowDownload: vi.fn(),
  fetchShowImages: vi.fn(),
  selectShowImage: vi.fn(),
}))

import { fetchShow } from '../api/shows.js'

const mockFetchShow = fetchShow as ReturnType<typeof vi.fn>

const makeDetail = (overrides = {}) => ({
  id: 'show-1',
  title: 'Breaking Bad',
  year: 2008,
  overview: 'A high school chemistry teacher turned meth cook.',
  genres: ['Drama', 'Crime'],
  rating: 9.5,
  posterUrl: null,
  backdropUrl: null,
  tmdbId: 1396,
  posterDownloaded: true,
  backdropDownloaded: true,
  status: 'ended' as const,
  ownedEpisodes: 62,
  totalEpisodes: 62,
  seasons: [
    { id: 's1', seasonNumber: 1, episodeCount: 7, ownedCount: 7 },
    { id: 's2', seasonNumber: 2, episodeCount: 13, ownedCount: 10 },
  ],
  credits: [
    { id: 'c1', role: 'director' as const, character: null, person: { id: 'p1', name: 'Vince Gilligan', profileUrl: null } },
    { id: 'c2', role: 'cast' as const, character: 'Walter White', person: { id: 'p2', name: 'Bryan Cranston', profileUrl: null } },
  ],
  ...overrides,
})

function renderPage(showId = 'show-1') {
  return render(
    <MemoryRouter initialEntries={[`/shows/${showId}`]}>
      <Routes>
        <Route path="/shows/:id" element={<ShowDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ShowDetailPage', () => {
  it('shows loading state', () => {
    mockFetchShow.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders show title and overview', async () => {
    mockFetchShow.mockResolvedValue(makeDetail())
    renderPage()
    await waitFor(() => expect(screen.getByText('Breaking Bad')).toBeInTheDocument())
    expect(screen.getByText('A high school chemistry teacher turned meth cook.')).toBeInTheDocument()
  })

  it('renders genres', async () => {
    mockFetchShow.mockResolvedValue(makeDetail())
    renderPage()
    await waitFor(() => expect(screen.getByText('Drama')).toBeInTheDocument())
    expect(screen.getByText('Crime')).toBeInTheDocument()
  })

  it('shows Ended status badge', async () => {
    mockFetchShow.mockResolvedValue(makeDetail())
    renderPage()
    await waitFor(() => expect(screen.getByText('Ended')).toBeInTheDocument())
  })

  it('shows Airing badge for continuing show', async () => {
    mockFetchShow.mockResolvedValue(makeDetail({ status: 'continuing' }))
    renderPage()
    await waitFor(() => expect(screen.getByText('Airing')).toBeInTheDocument())
  })

  it('renders season links', async () => {
    mockFetchShow.mockResolvedValue(makeDetail())
    renderPage()
    await waitFor(() => expect(screen.getByText('Season 1')).toBeInTheDocument())
    expect(screen.getByText('Season 2')).toBeInTheDocument()
    expect(screen.getByText('7/7 episodes')).toBeInTheDocument()
    expect(screen.getByText('10/13 episodes')).toBeInTheDocument()
  })

  it('renders cast and creators', async () => {
    mockFetchShow.mockResolvedValue(makeDetail())
    renderPage()
    await waitFor(() => expect(screen.getByText('Bryan Cranston')).toBeInTheDocument())
    expect(screen.getByText('Vince Gilligan')).toBeInTheDocument()
  })

  it('shows completeness counter', async () => {
    mockFetchShow.mockResolvedValue(makeDetail())
    renderPage()
    await waitFor(() => expect(screen.getByText(/62\/62 owned/)).toBeInTheDocument())
  })

  it('shows error with back link', async () => {
    mockFetchShow.mockRejectedValue(new Error('Not found'))
    renderPage()
    await waitFor(() => expect(screen.getByText('Not found')).toBeInTheDocument())
    expect(screen.getByText('← Back to Shows')).toBeInTheDocument()
  })
})

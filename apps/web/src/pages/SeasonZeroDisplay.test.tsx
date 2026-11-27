import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ShowDetailPage } from './ShowDetailPage.js'
import { ToastProvider } from '../context/ToastContext.js'

/**
 * Issue #95.
 *
 * Season 0's `episodeCount` is deliberately left at 0: the enricher refuses to
 * write it because provider specials data is unreliable (enricher.ts, ownedOnly
 * mode). The UI then rendered "4/0 episodes" and a 0% progress bar for a fully
 * owned specials season.
 *
 * A count of "all specials that exist" is not a target anyone aims at, so
 * season 0 gets a plain count rather than a ratio.
 */
vi.mock('../api/shows.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/shows.js')>()),
  fetchShow: vi.fn(),
  fetchShows: vi.fn(async () => []),
  fetchTvdbOrders: vi.fn(async () => []),
  fetchOrganizePreview: vi.fn(async () => ({ renames: [], removals: [] })),
  fetchShowImages: vi.fn(async () => []),
  triggerShowDownload: vi.fn(),
  selectShowImage: vi.fn(),
}))

vi.mock('../api/movies.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/movies.js')>()),
  fetchScanRoots: vi.fn(async () => []),
}))

vi.mock('../api/jellyfin.js', () => ({
  fetchJellyfinStatus: vi.fn(async () => ({ configured: false })),
  fetchJellyfinShowUrl: vi.fn(async () => null),
}))

import { fetchShow } from '../api/shows.js'

const mockFetchShow = fetchShow as ReturnType<typeof vi.fn>

const detail = (seasons: Array<{ id: string; seasonNumber: number; episodeCount: number; ownedCount: number }>) => ({
  id: 'show-1',
  title: 'Happy Days',
  year: 1974,
  overview: '',
  genres: [],
  rating: null,
  posterUrl: null,
  backdropUrl: null,
  tmdbId: 3845,
  posterDownloaded: true,
  backdropDownloaded: true,
  status: 'ended' as const,
  ownedEpisodes: 255,
  totalEpisodes: 251,
  seasons,
  credits: [],
  scanRoots: [],
})

function renderPage() {
  return render(
    <ToastProvider>
    <MemoryRouter initialEntries={['/shows/show-1']}>
      <Routes>
        <Route path="/shows/:id" element={<ShowDetailPage />} />
      </Routes>
    </MemoryRouter>
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('season 0 display (issue #95)', () => {
  it('renders a plain count for specials instead of owned/0', async () => {
    mockFetchShow.mockResolvedValue(
      detail([
        { id: 's0', seasonNumber: 0, episodeCount: 0, ownedCount: 4 },
        { id: 's1', seasonNumber: 1, episodeCount: 16, ownedCount: 16 },
      ]),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('Specials')).toBeInTheDocument())
    expect(screen.getByText('4 episodes')).toBeInTheDocument()
    expect(screen.queryByText('4/0 episodes')).not.toBeInTheDocument()
  })

  it('still renders a ratio for a normal season', async () => {
    mockFetchShow.mockResolvedValue(
      detail([{ id: 's1', seasonNumber: 1, episodeCount: 16, ownedCount: 12 }]),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('12/16 episodes')).toBeInTheDocument())
  })

  it('singularises a lone special', async () => {
    mockFetchShow.mockResolvedValue(
      detail([{ id: 's0', seasonNumber: 0, episodeCount: 0, ownedCount: 1 }]),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('1 episode')).toBeInTheDocument())
  })

  it('falls back to a plain count for any season with no known episodeCount', async () => {
    mockFetchShow.mockResolvedValue(
      detail([{ id: 's9', seasonNumber: 9, episodeCount: 0, ownedCount: 3 }]),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('3 episodes')).toBeInTheDocument())
  })
})

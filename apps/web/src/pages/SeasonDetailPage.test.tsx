import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SeasonDetailPage } from './SeasonDetailPage.js'

vi.mock('../api/shows.js', () => ({
  fetchSeason: vi.fn(),
}))

import { fetchSeason } from '../api/shows.js'

const mockFetchSeason = fetchSeason as ReturnType<typeof vi.fn>

const makeEpisode = (num: number, status: string, title = `Episode ${num}`) => ({
  id: `ep-${num}`,
  episodeNumber: num,
  title,
  airDate: '2008-01-20T00:00:00.000Z',
  status,
  files: [],
})

const makeEpisodeWithFile = (num: number) => ({
  ...makeEpisode(num, 'owned', `Owned Episode ${num}`),
  files: [
    {
      id: `file-${num}`,
      path: `/mnt/tv/Breaking Bad/Season 01/Breaking Bad - S01E0${num}.mkv`,
      sizeBytes: 2_147_483_648,
      durationS: 2700,
      videoCodec: 'H.265',
      videoResolution: '1080p',
      videoQualityTier: '1080p',
      hdr: false,
      audioCodec: 'AAC',
      audioChannels: '5.1',
      audioQualityTier: 'Standard',
    },
  ],
})

const makeSeason = (overrides = {}) => ({
  id: 'season-1',
  seasonNumber: 1,
  episodeCount: 7,
  show: { id: 'show-1', title: 'Breaking Bad', year: 2008 },
  episodes: [
    makeEpisode(1, 'owned', 'Pilot'),
    makeEpisode(2, 'owned', 'Cat\'s in the Bag'),
    makeEpisode(3, 'missing', 'And the Bag\'s in the River'),
    makeEpisode(4, 'not_yet_aired', 'Cancer Man'),
  ],
  ...overrides,
})

function renderPage(showId = 'show-1', season = '1') {
  return render(
    <MemoryRouter initialEntries={[`/shows/${showId}/season/${season}`]}>
      <Routes>
        <Route path="/shows/:id/season/:seasonNumber" element={<SeasonDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SeasonDetailPage', () => {
  it('shows loading state', () => {
    mockFetchSeason.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders season heading with owned count', async () => {
    mockFetchSeason.mockResolvedValue(makeSeason())
    renderPage()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Season 1' })).toBeInTheDocument())
    expect(screen.getByText('2/4 owned')).toBeInTheDocument()
  })

  it('renders episode titles', async () => {
    mockFetchSeason.mockResolvedValue(makeSeason())
    renderPage()
    await waitFor(() => expect(screen.getByText('Pilot')).toBeInTheDocument())
    expect(screen.getByText("Cat's in the Bag")).toBeInTheDocument()
  })

  it('renders episode status badges', async () => {
    mockFetchSeason.mockResolvedValue(makeSeason())
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Owned').length).toBeGreaterThan(0))
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.getByText('Not aired')).toBeInTheDocument()
  })

  it('renders breadcrumb with show title', async () => {
    mockFetchSeason.mockResolvedValue(makeSeason())
    renderPage()
    await waitFor(() => expect(screen.getByText('Breaking Bad')).toBeInTheDocument())
    expect(screen.getByText('TV Shows')).toBeInTheDocument()
  })

  it('renders tech badges for episodes with files', async () => {
    mockFetchSeason.mockResolvedValue(
      makeSeason({ episodes: [makeEpisodeWithFile(1)] }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('H.265')).toBeInTheDocument())
    expect(screen.getAllByText('1080p').length).toBeGreaterThan(0)
    expect(screen.getByText('AAC')).toBeInTheDocument()
  })

  it('shows error with back link', async () => {
    mockFetchSeason.mockRejectedValue(new Error('Not found'))
    renderPage()
    await waitFor(() => expect(screen.getByText('Not found')).toBeInTheDocument())
    expect(screen.getByText('← Back to Show')).toBeInTheDocument()
  })
})

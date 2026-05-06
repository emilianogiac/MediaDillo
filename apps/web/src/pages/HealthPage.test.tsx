import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HealthPage } from './HealthPage.js'

vi.mock('../api/library-health.js', () => ({
  fetchHealthItems: vi.fn(),
  fetchHealthSummary: vi.fn(),
  startBulkArtworkDownload: vi.fn(),
  fetchJobStatus: vi.fn(),
  refreshMetadata: vi.fn(),
}))

import {
  fetchHealthItems,
  fetchHealthSummary,
  startBulkArtworkDownload,
  fetchJobStatus,
  refreshMetadata,
} from '../api/library-health.js'

const mockItems = fetchHealthItems as ReturnType<typeof vi.fn>
const mockSummary = fetchHealthSummary as ReturnType<typeof vi.fn>
const mockBulkDownload = startBulkArtworkDownload as ReturnType<typeof vi.fn>
const mockJobStatus = fetchJobStatus as ReturnType<typeof vi.fn>
const mockRefresh = refreshMetadata as ReturnType<typeof vi.fn>

const makeItem = (overrides = {}) => ({
  id: 'item-1',
  type: 'movie' as const,
  title: 'Inception',
  year: 2010,
  posterDownloaded: false,
  backdropDownloaded: true,
  matched: true,
  metadataComplete: true,
  hasFiles: true,
  score: 4,
  ...overrides,
})

const emptySummary = { missingPoster: 0, missingBackdrop: 0, unmatched: 0, noFiles: 0 }

function renderPage() {
  return render(
    <MemoryRouter>
      <HealthPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockItems.mockResolvedValue([])
  mockSummary.mockResolvedValue(emptySummary)
})

describe('HealthPage', () => {
  it('renders heading and summary cards', async () => {
    renderPage()
    expect(screen.getByText('Library Health')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Missing poster')).toBeInTheDocument())
    expect(screen.getByText('Missing backdrop')).toBeInTheDocument()
    expect(screen.getByText('Unmatched')).toBeInTheDocument()
    expect(screen.getByText('No files')).toBeInTheDocument()
  })

  it('shows empty state when library is healthy', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('Library is fully healthy.')).toBeInTheDocument(),
    )
  })

  it('renders item rows with check indicators', async () => {
    mockItems.mockResolvedValue([makeItem()])
    renderPage()
    await waitFor(() => expect(screen.getByText('Inception')).toBeInTheDocument())
    expect(screen.getByText('(2010)')).toBeInTheDocument()
    expect(screen.getByText('Movie')).toBeInTheDocument()
    expect(screen.getByText('4/5')).toBeInTheDocument()
  })

  it('renders TV show items', async () => {
    mockItems.mockResolvedValue([makeItem({ id: 'show-1', type: 'show', title: 'The Wire', score: 3 })])
    renderPage()
    await waitFor(() => expect(screen.getByText('The Wire')).toBeInTheDocument())
    expect(screen.getByText('Show')).toBeInTheDocument()
    expect(screen.getByText('3/5')).toBeInTheDocument()
  })

  it('shows non-zero summary counts', async () => {
    mockSummary.mockResolvedValue({ missingPoster: 5, missingBackdrop: 3, unmatched: 2, noFiles: 1 })
    renderPage()
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument())
  })

  it('shows bulk download button when items exist', async () => {
    mockItems.mockResolvedValue([makeItem()])
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('Download all missing art')).toBeInTheDocument(),
    )
  })

  it('starts bulk artwork download job', async () => {
    mockItems.mockResolvedValue([makeItem()])
    const doneJob = { id: 'job-1', running: false, total: 1, done: 1, errors: [], startedAt: '', finishedAt: '' }
    mockBulkDownload.mockResolvedValue({ jobId: 'job-1', total: 1 })
    mockJobStatus.mockResolvedValue(doneJob)
    renderPage()
    await waitFor(() => expect(screen.getByText('Download all missing art')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Download all missing art'))
    await waitFor(() => expect(mockBulkDownload).toHaveBeenCalledWith('all'))
  })

  it('refreshes metadata for selected items', async () => {
    mockItems.mockResolvedValue([makeItem()])
    mockRefresh.mockResolvedValue({ jobId: 'job-2', total: 1 })
    mockJobStatus.mockResolvedValue({ id: 'job-2', running: false, total: 1, done: 1, errors: [], startedAt: '', finishedAt: '' })
    renderPage()
    await waitFor(() => expect(screen.getByText('Inception')).toBeInTheDocument())
    // Select item via checkbox
    const checkboxes = screen.getAllByRole('checkbox')
    const itemCheckbox = checkboxes[1] // first is select-all
    if (!itemCheckbox) throw new Error('Checkbox not found')
    fireEvent.click(itemCheckbox)
    fireEvent.click(screen.getByText(/Refresh metadata/))
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledWith(['item-1'], []))
  })

  it('shows incomplete-only filter', async () => {
    mockItems.mockResolvedValue([makeItem()])
    renderPage()
    await waitFor(() => expect(screen.getByText('Inception')).toBeInTheDocument())
    const incompleteCheckbox = screen.getByLabelText('Incomplete only')
    fireEvent.click(incompleteCheckbox)
    await waitFor(() => expect(mockItems).toHaveBeenCalledWith(expect.objectContaining({ incomplete: true })))
  })

  it('filters by type', async () => {
    mockItems.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(screen.getByText('Movies')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Movies'))
    await waitFor(() => expect(mockItems).toHaveBeenCalledWith(expect.objectContaining({ type: 'movies' })))
  })
})

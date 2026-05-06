import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { FilesPage } from './FilesPage.js'

vi.mock('../api/files.js', () => ({
  fetchRenamePreview: vi.fn(),
  applyRenames: vi.fn(),
  fetchStaleFiles: vi.fn(),
  deleteStaleFile: vi.fn(),
  resolveStaleFile: vi.fn(),
  bulkDeleteStaleFiles: vi.fn(),
}))

import {
  fetchRenamePreview,
  applyRenames,
  fetchStaleFiles,
  deleteStaleFile,
  resolveStaleFile,
  bulkDeleteStaleFiles,
} from '../api/files.js'

const mockPreview = fetchRenamePreview as ReturnType<typeof vi.fn>
const mockApply = applyRenames as ReturnType<typeof vi.fn>
const mockStale = fetchStaleFiles as ReturnType<typeof vi.fn>
const mockDelete = deleteStaleFile as ReturnType<typeof vi.fn>
const mockResolve = resolveStaleFile as ReturnType<typeof vi.fn>
const mockBulkDelete = bulkDeleteStaleFiles as ReturnType<typeof vi.fn>

const makePreviewItem = (overrides = {}) => ({
  id: 'file-1',
  type: 'movie-file' as const,
  currentPath: '/nas/films/batman begins/batman.begins.mkv',
  proposedPath: '/nas/films/Batman Begins (2005)/Batman Begins (2005).mkv',
  needsRename: true,
  ...overrides,
})

const makeStaleFile = (overrides = {}) => ({
  id: 'stale-1',
  path: '/nas/films/Inception (2010)/Inception.tbn',
  reason: 'Unknown file type',
  resolved: false,
  createdAt: '2026-05-05T00:00:00Z',
  scanLog: { startedAt: '2026-05-05T00:00:00Z' },
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockPreview.mockResolvedValue([])
  mockStale.mockResolvedValue({ items: [], total: 0 })
})

describe('FilesPage', () => {
  it('renders heading and tabs', async () => {
    render(<FilesPage />)
    expect(screen.getByText('File Manager')).toBeInTheDocument()
    expect(screen.getByText('Rename Queue')).toBeInTheDocument()
    expect(screen.getByText('Stale Files')).toBeInTheDocument()
  })

  describe('Rename Queue tab', () => {
    it('shows empty state when all files are canonical', async () => {
      render(<FilesPage />)
      await waitFor(() =>
        expect(
          screen.getByText('All movie files follow the naming convention.'),
        ).toBeInTheDocument(),
      )
    })

    it('renders rename items that need changes', async () => {
      mockPreview.mockResolvedValue([makePreviewItem()])
      render(<FilesPage />)
      await waitFor(() =>
        expect(screen.getByText('batman.begins.mkv')).toBeInTheDocument(),
      )
      expect(screen.getByText('Batman Begins (2005).mkv')).toBeInTheDocument()
    })

    it('shows folder change when directory differs', async () => {
      mockPreview.mockResolvedValue([makePreviewItem()])
      render(<FilesPage />)
      await waitFor(() => expect(screen.getByText(/batman begins/)).toBeInTheDocument())
      expect(screen.getAllByText(/Batman Begins \(2005\)/).length).toBeGreaterThanOrEqual(1)
    })

    it('applies selected renames', async () => {
      mockPreview.mockResolvedValue([makePreviewItem()])
      mockApply.mockResolvedValue({ renamed: 1, errors: [] })
      render(<FilesPage />)
      await waitFor(() => expect(screen.getByText('batman.begins.mkv')).toBeInTheDocument())
      fireEvent.click(screen.getByText(/Rename 1 file/))
      await waitFor(() => expect(mockApply).toHaveBeenCalledWith('movies', ['file-1']))
      expect(screen.getByText('1 file renamed.')).toBeInTheDocument()
    })

    it('shows error message on rename failure', async () => {
      mockPreview.mockResolvedValue([makePreviewItem()])
      mockApply.mockRejectedValue(new Error('Permission denied'))
      render(<FilesPage />)
      await waitFor(() => expect(screen.getByText('batman.begins.mkv')).toBeInTheDocument())
      fireEvent.click(screen.getByText(/Rename 1 file/))
      await waitFor(() =>
        expect(screen.getByText('Permission denied')).toBeInTheDocument(),
      )
    })

    it('switches to episodes type', async () => {
      mockPreview.mockResolvedValue([])
      render(<FilesPage />)
      fireEvent.click(screen.getByText('TV Episodes'))
      await waitFor(() =>
        expect(
          screen.getByText('All episode files follow the naming convention.'),
        ).toBeInTheDocument(),
      )
      expect(mockPreview).toHaveBeenCalledWith('episodes')
    })
  })

  describe('Stale Files tab', () => {
    function switchToStale() {
      fireEvent.click(screen.getByText('Stale Files'))
    }

    it('shows empty state when no stale files', async () => {
      render(<FilesPage />)
      switchToStale()
      await waitFor(() =>
        expect(screen.getByText('No stale files to review.')).toBeInTheDocument(),
      )
    })

    it('renders stale file entries', async () => {
      mockStale.mockResolvedValue({ items: [makeStaleFile()], total: 1 })
      render(<FilesPage />)
      switchToStale()
      await waitFor(() =>
        expect(screen.getByText('/nas/films/Inception (2010)/Inception.tbn')).toBeInTheDocument(),
      )
      expect(screen.getByText('Unknown file type')).toBeInTheDocument()
    })

    it('deletes a stale file', async () => {
      mockStale.mockResolvedValue({ items: [makeStaleFile()], total: 1 })
      mockDelete.mockResolvedValue(undefined)
      render(<FilesPage />)
      switchToStale()
      await waitFor(() => expect(screen.getByText('Trash')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Trash'))
      await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('stale-1'))
    })

    it('resolves (ignores) a stale file', async () => {
      mockStale.mockResolvedValue({ items: [makeStaleFile()], total: 1 })
      mockResolve.mockResolvedValue(undefined)
      render(<FilesPage />)
      switchToStale()
      await waitFor(() => expect(screen.getByText('Ignore')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Ignore'))
      await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('stale-1'))
    })

    it('bulk deletes selected files', async () => {
      mockStale.mockResolvedValue({
        items: [makeStaleFile(), makeStaleFile({ id: 'stale-2', path: '/nas/other.tbn' })],
        total: 2,
      })
      mockBulkDelete.mockResolvedValue({ deleted: 2, errors: [] })
      render(<FilesPage />)
      switchToStale()
      await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0))
      // Select all via header checkbox
      const checkboxes = screen.getAllByRole('checkbox')
      const selectAll = checkboxes[0]
      if (!selectAll) throw new Error('Select all checkbox not found')
      fireEvent.click(selectAll) // "select all" checkbox
      await waitFor(() =>
        expect(screen.getByText(/Delete 2 to trash/)).toBeInTheDocument(),
      )
      fireEvent.click(screen.getByText(/Delete 2 to trash/))
      await waitFor(() => expect(mockBulkDelete).toHaveBeenCalledWith(['stale-1', 'stale-2']))
    })
  })
})

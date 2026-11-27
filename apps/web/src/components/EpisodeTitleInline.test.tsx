import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EpisodeTitleInline } from './EpisodeTitleInline.js'
import { ToastProvider } from '../context/ToastContext.js'

/**
 * Issue #101 — make the #96 title lock visible and operable.
 *
 * A corrected title is protected from enrichment, but until it is shown in the
 * UI the user cannot tell a protected title from an unprotected one, nor undo
 * the protection.
 */
vi.mock('../api/shows.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/shows.js')>()),
  updateEpisodeTitle: vi.fn(async () => ({})),
  resetEpisodeTitle: vi.fn(async () => ({})),
}))

const { updateEpisodeTitle, resetEpisodeTitle } = await import('../api/shows.js')

function renderTitle(overrides: Partial<React.ComponentProps<typeof EpisodeTitleInline>> = {}) {
  const onChanged = vi.fn()
  render(
    <ToastProvider>
      <EpisodeTitleInline
        showId="show-1"
        episodeId="ep-1"
        episodeNumber={28}
        title="Il promesso puffo"
        titleSource="provider"
        onChanged={onChanged}
        {...overrides}
      />
    </ToastProvider>,
  )
  return { onChanged }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EpisodeTitleInline (issue #101)', () => {
  it('shows no lock badge for a provider title', () => {
    renderTitle()
    expect(screen.queryByLabelText('Title locked')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Unlock title/)).not.toBeInTheDocument()
  })

  it('shows a lock badge and an unlock action for a manual title', () => {
    renderTitle({ titleSource: 'manual' })
    expect(screen.getByLabelText('Title locked')).toBeInTheDocument()
    expect(screen.getByLabelText('Unlock title for episode 28')).toBeInTheDocument()
  })

  it('explains what the lock means on hover', () => {
    renderTitle({ titleSource: 'manual' })
    expect(screen.getByLabelText('Title locked').getAttribute('title')).toMatch(
      /will not be overwritten/i,
    )
  })

  it('saving an edited title locks it', async () => {
    const user = userEvent.setup()
    const { onChanged } = renderTitle()
    await user.click(screen.getByLabelText('Edit title for episode 28'))
    const input = screen.getByLabelText('Title for episode 28')
    await user.clear(input)
    await user.type(input, 'Tutto è puffo quel che finisce puffo')
    await user.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(updateEpisodeTitle).toHaveBeenCalledWith(
        'show-1',
        'ep-1',
        'Tutto è puffo quel che finisce puffo',
      ),
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('unlocking hands the title back to the provider', async () => {
    const user = userEvent.setup()
    const { onChanged } = renderTitle({ titleSource: 'manual' })
    await user.click(screen.getByLabelText('Unlock title for episode 28'))
    await waitFor(() => expect(resetEpisodeTitle).toHaveBeenCalledWith('show-1', 'ep-1'))
    expect(onChanged).toHaveBeenCalled()
  })

  it('refuses to save an empty title', async () => {
    const user = userEvent.setup()
    renderTitle()
    await user.click(screen.getByLabelText('Edit title for episode 28'))
    await user.clear(screen.getByLabelText('Title for episode 28'))
    await user.click(screen.getByText('Save'))
    expect(updateEpisodeTitle).not.toHaveBeenCalled()
  })

  it('cancel leaves the title untouched', async () => {
    const user = userEvent.setup()
    renderTitle()
    await user.click(screen.getByLabelText('Edit title for episode 28'))
    await user.type(screen.getByLabelText('Title for episode 28'), 'scribble')
    await user.click(screen.getByText('Cancel'))
    expect(updateEpisodeTitle).not.toHaveBeenCalled()
    expect(screen.getByText('Il promesso puffo')).toBeInTheDocument()
  })

  it('falls back to a placeholder when the episode has no title', () => {
    renderTitle({ title: null })
    expect(screen.getByText('Episode 28')).toBeInTheDocument()
  })
})

/**
 * Issue #103 — #101 shipped Edit and Unlock but no Lock, so a title that was
 * already correct could not be protected without first changing it.
 */
describe('locking a title that is already correct (issue #103)', () => {
  it('offers Lock for a provider title', () => {
    renderTitle()
    expect(screen.getByLabelText('Lock title for episode 28')).toBeInTheDocument()
  })

  it('does not offer Lock for an already-locked title', () => {
    renderTitle({ titleSource: 'manual' })
    expect(screen.queryByLabelText('Lock title for episode 28')).not.toBeInTheDocument()
  })

  it('Lock protects the existing title without changing it', async () => {
    const user = userEvent.setup()
    const { onChanged } = renderTitle()
    await user.click(screen.getByLabelText('Lock title for episode 28'))
    await waitFor(() =>
      expect(updateEpisodeTitle).toHaveBeenCalledWith('show-1', 'ep-1', 'Il promesso puffo'),
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('cannot lock an episode that has no title', async () => {
    renderTitle({ title: null })
    const btn = screen.getByLabelText('Lock title for episode 28')
    expect(btn).toBeDisabled()
    expect(btn.getAttribute('title')).toMatch(/give the episode a title/i)
  })

  it('saving unchanged text still locks an unlocked title', async () => {
    const user = userEvent.setup()
    renderTitle()
    await user.click(screen.getByLabelText('Edit title for episode 28'))
    await user.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(updateEpisodeTitle).toHaveBeenCalledWith('show-1', 'ep-1', 'Il promesso puffo'),
    )
  })

  it('saving unchanged text on a locked title is a no-op', async () => {
    const user = userEvent.setup()
    renderTitle({ titleSource: 'manual' })
    await user.click(screen.getByLabelText('Edit title for episode 28'))
    await user.click(screen.getByText('Save'))
    expect(updateEpisodeTitle).not.toHaveBeenCalled()
  })
})

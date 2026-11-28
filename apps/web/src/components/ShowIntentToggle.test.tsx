import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShowIntentToggle } from './ShowIntentToggle.js'
import { ToastProvider } from '../context/ToastContext.js'

/**
 * Issue #122 — "incomplete" conflated a show missing a few episodes with one
 * held as a deliberate sample (One Piece: 61 of 2351). Intent is not derivable,
 * so it is recorded.
 */
vi.mock('../api/shows.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/shows.js')>()),
  setShowAbandoned: vi.fn(async () => ({ id: 's1', title: 'One Piece', abandoned: true })),
}))

const { setShowAbandoned } = await import('../api/shows.js')

function renderToggle(overrides: Partial<React.ComponentProps<typeof ShowIntentToggle>> = {}) {
  const onChanged = vi.fn()
  render(
    <ToastProvider>
      <ShowIntentToggle
        showId="s1"
        title="One Piece"
        abandoned={false}
        ownedEpisodes={61}
        totalEpisodes={2351}
        onChanged={onChanged}
        {...overrides}
      />
    </ToastProvider>,
  )
  return { onChanged }
}

beforeEach(() => vi.clearAllMocks())

describe('ShowIntentToggle', () => {
  it('offers Abandon on an incomplete show', () => {
    renderToggle()
    expect(screen.getByLabelText('Mark One Piece abandoned')).toBeInTheDocument()
  })

  it('names the size of the gap, so the decision is informed', () => {
    renderToggle()
    expect(screen.getByLabelText('Mark One Piece abandoned').getAttribute('title')).toMatch(
      /Missing 2290 episodes/,
    )
  })

  it('records the intent when Abandon is clicked', async () => {
    const user = userEvent.setup()
    const { onChanged } = renderToggle()
    await user.click(screen.getByLabelText('Mark One Piece abandoned'))
    await waitFor(() => expect(setShowAbandoned).toHaveBeenCalledWith('s1', true))
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows the badge and a Resume action once abandoned', () => {
    renderToggle({ abandoned: true })
    expect(screen.getByLabelText('Show abandoned')).toBeInTheDocument()
    expect(screen.getByLabelText('Resume collecting One Piece')).toBeInTheDocument()
    expect(screen.queryByLabelText('Mark One Piece abandoned')).not.toBeInTheDocument()
  })

  it('explains what abandoning does on hover', () => {
    renderToggle({ abandoned: true })
    expect(screen.getByLabelText('Show abandoned').getAttribute('title')).toMatch(
      /excluded from the missing-episode queue/i,
    )
  })

  it('resuming hands the show back to the missing queue', async () => {
    const user = userEvent.setup()
    const { onChanged } = renderToggle({ abandoned: true })
    await user.click(screen.getByLabelText('Resume collecting One Piece'))
    await waitFor(() => expect(setShowAbandoned).toHaveBeenCalledWith('s1', false))
    expect(onChanged).toHaveBeenCalled()
  })

  it('renders nothing for a complete show — there is no gap to judge', () => {
    const { container } = render(
      <ToastProvider>
        <ShowIntentToggle showId="s1" title="Sampei" abandoned={false}
          ownedEpisodes={109} totalEpisodes={109} onChanged={vi.fn()} />
      </ToastProvider>,
    )
    expect(container.querySelector('button')).toBeNull()
  })

  it('renders nothing when the provider supplies no episode count', () => {
    const { container } = render(
      <ToastProvider>
        <ShowIntentToggle showId="s1" title="Unmatched" abandoned={false}
          ownedEpisodes={12} totalEpisodes={0} onChanged={vi.fn()} />
      </ToastProvider>,
    )
    expect(container.querySelector('button')).toBeNull()
  })

  it('still shows the badge for an abandoned show that is now complete', () => {
    renderToggle({ abandoned: true, ownedEpisodes: 109, totalEpisodes: 109 })
    expect(screen.getByLabelText('Show abandoned')).toBeInTheDocument()
  })

  it('does not report success, or re-render as abandoned, when the save fails', async () => {
    const user = userEvent.setup()
    vi.mocked(setShowAbandoned).mockRejectedValueOnce(new Error('nope'))
    const { onChanged } = renderToggle()
    await user.click(screen.getByLabelText('Mark One Piece abandoned'))

    // onChanged drives the reload, so calling it on failure would show the user a
    // state the server never accepted.
    await waitFor(() =>
      expect(screen.getByLabelText('Mark One Piece abandoned')).not.toBeDisabled(),
    )
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Show abandoned')).not.toBeInTheDocument()
  })
})

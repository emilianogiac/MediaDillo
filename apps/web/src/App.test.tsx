import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// App mounts the real Dashboard, whose cards fetch on mount. jsdom has no origin to
// resolve a relative URL against, so an unstubbed call rejects and the suite exits
// non-zero on unhandled errors even with every assertion passing (issue #98).
vi.mock('./api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api/client.js')>()),
  apiFetch: vi.fn().mockResolvedValue([]),
}))

import App from './App'

describe('App', () => {
  it('renders the navigation sidebar with app name', () => {
    render(<App />)
    expect(screen.getAllByText(/MediaDillo/).length).toBeGreaterThan(0)
  })

  it('renders nav links', () => {
    render(<App />)
    const nav = screen.getByRole('navigation')
    expect(nav.textContent).toContain('Dashboard')
    expect(nav.textContent).toContain('Movies')
    expect(nav.textContent).toContain('TV Shows')
  })
})

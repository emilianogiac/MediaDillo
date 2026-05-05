import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
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

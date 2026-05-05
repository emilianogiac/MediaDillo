import { describe, it, expect } from 'vitest'
import { tmdbImageUrl } from './tmdb-client.js'

describe('tmdbImageUrl', () => {
  it('builds poster URL correctly', () => {
    const url = tmdbImageUrl('/abc123.jpg', 'w500')
    expect(url).toBe('https://image.tmdb.org/t/p/w500/abc123.jpg')
  })

  it('builds backdrop URL with w1280', () => {
    const url = tmdbImageUrl('/backdrop.jpg', 'w1280')
    expect(url).toBe('https://image.tmdb.org/t/p/w1280/backdrop.jpg')
  })

  it('returns null for null path', () => {
    expect(tmdbImageUrl(null, 'w500')).toBeNull()
  })
})

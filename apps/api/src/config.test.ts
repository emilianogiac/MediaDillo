import { describe, it, expect } from 'vitest'
import { z } from 'zod'

const ScanRootSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['movies', 'tv']),
})

describe('ScanRoot config schema', () => {
  it('accepts valid movie root', () => {
    const result = ScanRootSchema.safeParse({
      path: '/mnt/nas/film',
      label: 'Films',
      type: 'movies',
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid tv root', () => {
    const result = ScanRootSchema.safeParse({ path: '/mnt/nas/tv', label: 'TV', type: 'tv' })
    expect(result.success).toBe(true)
  })

  it('rejects unknown type', () => {
    const result = ScanRootSchema.safeParse({ path: '/x', label: 'X', type: 'music' })
    expect(result.success).toBe(false)
  })

  it('rejects empty path', () => {
    const result = ScanRootSchema.safeParse({ path: '', label: 'X', type: 'movies' })
    expect(result.success).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { reconcileStaleFiles, isUnderRoots } from './stale-reconcile.js'

const ROOTS = ['/mnt/nas/film', '/mnt/nas/cartoni_tv']

const entry = (path: string, reason = 'unrecognized file') => ({ path, reason })

describe('isUnderRoots', () => {
  it('matches a file inside a root', () => {
    expect(isUnderRoots('/mnt/nas/film/Movie (2020)/poster.tbn', ROOTS)).toBe(true)
  })

  it('does not let one root capture a sibling with the same prefix', () => {
    // "/mnt/nas/film" must not swallow "/mnt/nas/film_4k", or scanning Film would
    // resolve every stale row in Film 4K.
    expect(isUnderRoots('/mnt/nas/film_4k/Movie (2020)/poster.tbn', ROOTS)).toBe(false)
  })

  it('does not match an unrelated root', () => {
    expect(isUnderRoots('/mnt/nas/serie_tv/Show/x.tbn', ROOTS)).toBe(false)
  })

  it('tolerates a trailing slash on the root', () => {
    expect(isUnderRoots('/mnt/nas/film/x.tbn', ['/mnt/nas/film/'])).toBe(true)
  })
})

describe('reconcileStaleFiles (issue #73)', () => {
  it('does not create a second row for a path that is still stale', () => {
    // This is what produced 40,412 rows from 23,392 distinct paths.
    const existing = [{ id: 'r1', path: '/mnt/nas/film/A/old.tbn' }]
    const current = [entry('/mnt/nas/film/A/old.tbn')]

    const { resolveIds, create } = reconcileStaleFiles(existing, current, ROOTS)

    expect(create).toEqual([])
    expect(resolveIds).toEqual([])
  })

  it('resolves a row whose file has vanished', () => {
    // 11,338 distinct paths were in this state: deleted or moved to .trash, with the
    // row left unresolved forever.
    const existing = [{ id: 'r1', path: '/mnt/nas/film/A/gone.tbn' }]

    const { resolveIds, create } = reconcileStaleFiles(existing, [], ROOTS)

    expect(resolveIds).toEqual(['r1'])
    expect(create).toEqual([])
  })

  it('resolves a row for a file that is no longer considered stale', () => {
    // After #71 taught the scanner that .sup is a subtitle, the four live PGS tracks
    // for Grindelwald stopped being stale but stayed flagged.
    const sup = '/mnt/nas/film/Animali fantastici (2018)/Animali fantastici (2018).eng.sup'
    const existing = [{ id: 'r1', path: sup }]

    const { resolveIds } = reconcileStaleFiles(existing, [], ROOTS)

    expect(resolveIds).toEqual(['r1'])
  })

  it('creates a row for a genuinely new stale path', () => {
    const { resolveIds, create } = reconcileStaleFiles([], [entry('/mnt/nas/film/A/new.tbn')], ROOTS)

    expect(create).toEqual([entry('/mnt/nas/film/A/new.tbn')])
    expect(resolveIds).toEqual([])
  })

  it('leaves rows outside the scanned roots completely alone', () => {
    // A partial scan knows nothing about roots it did not walk; resolving those rows
    // would silently clear most of the list.
    const existing = [
      { id: 'inside', path: '/mnt/nas/film/A/x.tbn' },
      { id: 'outside', path: '/mnt/nas/serie_tv/Show/y.tbn' },
    ]

    const { resolveIds, create } = reconcileStaleFiles(existing, [], ['/mnt/nas/film'])

    expect(resolveIds).toEqual(['inside'])
    expect(create).toEqual([])
  })

  it('handles the mixed case in one pass', () => {
    const existing = [
      { id: 'keep', path: '/mnt/nas/film/A/still.tbn' },
      { id: 'gone', path: '/mnt/nas/film/A/vanished.tbn' },
      { id: 'other', path: '/mnt/nas/serie_tv/S/elsewhere.tbn' },
    ]
    const current = [entry('/mnt/nas/film/A/still.tbn'), entry('/mnt/nas/film/A/fresh.tbn')]

    const { resolveIds, create } = reconcileStaleFiles(existing, current, ROOTS)

    expect(resolveIds).toEqual(['gone'])
    expect(create.map((c) => c.path)).toEqual(['/mnt/nas/film/A/fresh.tbn'])
  })

  it('deduplicates repeats within a single scan', () => {
    const current = [entry('/mnt/nas/film/A/dup.tbn'), entry('/mnt/nas/film/A/dup.tbn')]

    const { create } = reconcileStaleFiles([], current, ROOTS)

    expect(create).toHaveLength(1)
  })

  it('preserves the reason recorded for a new path', () => {
    const current = [entry('/mnt/nas/film/A/x.sup', 'unrecognized file')]

    const { create } = reconcileStaleFiles([], current, ROOTS)

    expect(create[0]?.reason).toBe('unrecognized file')
  })

  it('is a no-op when nothing is stale and nothing was recorded', () => {
    expect(reconcileStaleFiles([], [], ROOTS)).toEqual({ resolveIds: [], create: [] })
  })
})

import { describe, it, expect } from 'vitest'
import { identityKey, planDedup, type DedupShow } from './dedup.js'

/**
 * Issue #118 — the endpoint grouped shows by lowercased title alone and
 * hard-deleted episode rows. These cases are taken from the two live libraries.
 */
function show(over: Partial<DedupShow> & { id: string }): DedupShow {
  return {
    title: 'Untitled',
    year: null,
    tmdbId: null,
    tvdbId: null,
    createdAt: new Date('2026-01-01'),
    seasons: [],
    ...over,
  }
}

function season(seasonNumber: number, episodeNumbers: number[], idPrefix = 's'): DedupShow['seasons'][number] {
  return {
    id: `${idPrefix}${seasonNumber}`,
    seasonNumber,
    episodes: episodeNumbers.map((n) => ({ id: `${idPrefix}${seasonNumber}e${n}`, episodeNumber: n, fileCount: 1 })),
  }
}

describe('identityKey', () => {
  it('prefers tvdbId over tmdbId and title', () => {
    expect(identityKey(show({ id: 'a', tvdbId: 77847, tmdbId: 2875, title: 'MacGyver' }))).toBe('tvdb:77847')
  })

  it('falls back to tmdbId when there is no tvdbId', () => {
    expect(identityKey(show({ id: 'a', tmdbId: 2875, title: 'MacGyver' }))).toBe('tmdb:2875')
  })

  it('falls back to title and year for an unmatched show', () => {
    expect(identityKey(show({ id: 'a', title: '  MacGyver  ', year: 1985 }))).toBe('title:macgyver|1985')
  })

  it('distinguishes unmatched shows that share a title but not a year', () => {
    const a = identityKey(show({ id: 'a', title: 'MacGyver', year: 1985 }))
    const b = identityKey(show({ id: 'b', title: 'MacGyver', year: 2016 }))
    expect(a).not.toBe(b)
  })
})

describe('planDedup — the reboot that caused the bug', () => {
  it('never merges two series whose provider ids disagree', () => {
    const plan = planDedup([
      show({ id: 'mac85', title: 'MacGyver', year: 1985, tmdbId: 2875, tvdbId: 77847, seasons: [season(1, [1, 2, 3])] }),
      show({ id: 'mac16', title: 'MacGyver', year: 2016, tmdbId: 67133, tvdbId: 311902, seasons: [season(1, [1, 2, 3], 'r')] }),
    ])
    expect(plan.merges).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  it('also leaves Life on Mars 2006 and 2008 alone', () => {
    const plan = planDedup([
      show({ id: 'lom06', title: 'Life on Mars', year: 2006, tmdbId: 2973, tvdbId: 79177, seasons: [season(1, [1, 2])] }),
      show({ id: 'lom08', title: 'Life on Mars', year: 2008, tmdbId: 3725, tvdbId: 82289, seasons: [season(1, [1, 2], 'r')] }),
    ])
    expect(plan.merges).toEqual([])
    expect(plan.conflicts).toEqual([])
  })
})

describe('planDedup — a shared provider id is not enough to merge', () => {
  it('reports a conflict rather than deleting episode rows (the M.A.S.K. case)', () => {
    const plan = planDedup([
      show({ id: 'maskIta', title: 'M.A.S.K.', year: 1985, tmdbId: 4961, tvdbId: 71117, seasons: [season(1, [1, 2, 3])] }),
      show({ id: 'maskEng', title: 'M.A.S.K.', year: 1985, tmdbId: 4961, tvdbId: 71117, seasons: [season(1, [1, 2, 3], 'r')] }),
    ])
    expect(plan.merges).toEqual([])
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]!.reason).toBe('episode-collision')
    expect(plan.conflicts[0]!.collisions).toHaveLength(3)
  })

  it('reports every colliding slot so a human can see the overlap', () => {
    const plan = planDedup([
      show({ id: 'a', tvdbId: 1, seasons: [season(2, [5, 6])] }),
      show({ id: 'b', tvdbId: 1, seasons: [season(2, [5, 6], 'r')] }),
    ])
    expect(plan.conflicts[0]!.collisions).toEqual([
      { seasonNumber: 2, episodeNumber: 5 },
      { seasonNumber: 2, episodeNumber: 6 },
    ])
  })
})

describe('planDedup — the season-split case it should fix (Andor)', () => {
  it('merges two records of one series holding disjoint seasons', () => {
    const plan = planDedup([
      show({ id: 'andor1', title: 'Andor', year: 2022, tvdbId: 393189, seasons: [season(1, [1, 2, 3])] }),
      show({ id: 'andor2', title: 'Andor', year: 2022, tvdbId: 393189, seasons: [season(2, [1, 2, 3], 'r')] }),
    ])
    expect(plan.conflicts).toEqual([])
    expect(plan.merges).toHaveLength(1)
    expect(plan.merges[0]!.seasonsToReparent).toEqual(['r2'])
    expect(plan.merges[0]!.episodesToReparent).toEqual([])
    expect(plan.merges[0]!.seasonsToDelete).toEqual([])
  })

  it('moves episodes individually when the season already exists but the slots are free', () => {
    const plan = planDedup([
      show({ id: 'a', tvdbId: 1, seasons: [season(1, [1, 2])] }),
      show({ id: 'b', tvdbId: 1, seasons: [season(1, [3, 4], 'r')] }),
    ])
    expect(plan.merges[0]!.episodesToReparent).toEqual([
      { episodeId: 'r1e3', targetSeasonNumber: 1 },
      { episodeId: 'r1e4', targetSeasonNumber: 1 },
    ])
    expect(plan.merges[0]!.seasonsToDelete).toEqual(['r1'])
    expect(plan.merges[0]!.seasonsToReparent).toEqual([])
  })
})

describe('planDedup — canonical selection is deterministic', () => {
  it('keeps the record holding the most files', () => {
    const few = show({ id: 'few', tvdbId: 1, seasons: [season(1, [1])] })
    const many = show({ id: 'many', tvdbId: 1, seasons: [{ id: 'm1', seasonNumber: 2, episodes: [{ id: 'm1e1', episodeNumber: 1, fileCount: 9 }] }] })
    const plan = planDedup([few, many])
    expect(plan.merges[0]!.canonicalId).toBe('many')
    expect(plan.merges[0]!.duplicateId).toBe('few')
  })

  it('breaks a file-count tie on episode count, then on age', () => {
    const older = show({ id: 'older', tvdbId: 1, createdAt: new Date('2020-01-01'), seasons: [season(1, [1])] })
    const newer = show({ id: 'newer', tvdbId: 1, createdAt: new Date('2026-01-01'), seasons: [season(2, [1], 'r')] })
    expect(planDedup([newer, older]).merges[0]!.canonicalId).toBe('older')
  })

  it('does not depend on input order', () => {
    const a = show({ id: 'a', tvdbId: 1, createdAt: new Date('2020-01-01'), seasons: [season(1, [1])] })
    const b = show({ id: 'b', tvdbId: 1, createdAt: new Date('2026-01-01'), seasons: [season(2, [1], 'r')] })
    expect(planDedup([a, b]).merges[0]!.canonicalId).toBe(planDedup([b, a]).merges[0]!.canonicalId)
  })
})

describe('planDedup — scope', () => {
  it('ignores a show with no duplicate', () => {
    expect(planDedup([show({ id: 'solo', tvdbId: 1, seasons: [season(1, [1])] })])).toEqual({ merges: [], conflicts: [] })
  })

  it('groups unmatched shows by title and year', () => {
    const plan = planDedup([
      show({ id: 'a', title: 'Benny Hill', year: 1969, seasons: [season(1, [1])] }),
      show({ id: 'b', title: 'benny hill', year: 1969, seasons: [season(2, [1], 'r')] }),
    ])
    expect(plan.merges).toHaveLength(1)
  })

  it('handles a group of three, merging each safe duplicate into one canonical', () => {
    const plan = planDedup([
      show({ id: 'a', tvdbId: 1, seasons: [season(1, [1, 2])] }),
      show({ id: 'b', tvdbId: 1, seasons: [season(2, [1], 'r')] }),
      show({ id: 'c', tvdbId: 1, seasons: [season(3, [1], 'q')] }),
    ])
    expect(plan.merges).toHaveLength(2)
    expect(new Set(plan.merges.map((m) => m.canonicalId))).toEqual(new Set(['a']))
  })
})

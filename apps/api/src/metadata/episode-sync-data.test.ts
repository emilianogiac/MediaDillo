import { describe, it, expect } from 'vitest'
import { episodeSyncData } from './enricher.js'

/**
 * Issue #96.
 *
 * Enrichment must not clobber a human-verified episode title. The rest of the
 * row (air date, status) still syncs — only the title is held back.
 *
 * This matters because enrichment is not always user-initiated: a successful
 * rename calls `triggerLibraryRefresh`, which re-enriches the show.
 */
const AIRED = new Date('1986-09-13')

describe('episodeSyncData (issue #96)', () => {
  it('writes the provider title when the title is provider-owned', () => {
    const data = episodeSyncData({ titleSource: 'provider' }, 'The Smurfette', AIRED, 'owned')
    expect(data.title).toBe('The Smurfette')
  })

  it('omits the title entirely when the title is manual', () => {
    const data = episodeSyncData({ titleSource: 'manual' }, 'The Smurfette', AIRED, 'owned')
    expect('title' in data).toBe(false)
  })

  it('still syncs airDate and status for a manual title', () => {
    const data = episodeSyncData({ titleSource: 'manual' }, 'The Smurfette', AIRED, 'not_yet_aired')
    expect(data.airDate).toBe(AIRED)
    expect(data.status).toBe('not_yet_aired')
  })

  it('does not resurrect a provider title by writing null over a manual one', () => {
    // TVDB returns null names for untranslated episodes; a manual title must survive that too.
    const data = episodeSyncData({ titleSource: 'manual' }, null, AIRED, 'owned')
    expect('title' in data).toBe(false)
  })

  it('passes a null provider title through when provider-owned', () => {
    const data = episodeSyncData({ titleSource: 'provider' }, null, AIRED, 'owned')
    expect(data.title).toBeNull()
  })
})

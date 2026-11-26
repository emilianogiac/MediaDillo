import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Issue #89. The two-phase remap endpoints write an intermediate file before renaming
 * it to its final name. That intermediate name must never begin with a dot:
 *
 *  - On an SMB/CIFS share Samba sets the DOS HIDDEN attribute on any dot-file, and the
 *    attribute SURVIVES the rename back to a normal name. Every reordered episode
 *    became invisible in Finder while `ls` still listed it.
 *  - The scanner's walker skips entries beginning with a dot, so a crash mid-remap
 *    would leave a file MediaDillo could never see.
 *
 * Asserted against the source because the failure is a filesystem attribute set by the
 * server — nothing in a unit test's own filesystem would reproduce it.
 */
describe('two-phase remap temp filenames (issue #89)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'shows.ts'), 'utf8')

  it('uses a prefix that is not dot-prefixed', () => {
    const m = /export const REMAP_TMP_PREFIX = '([^']+)'/.exec(src)
    expect(m, 'REMAP_TMP_PREFIX should be declared in shows.ts').toBeTruthy()
    expect(m![1]!.startsWith('.')).toBe(false)
  })

  it('builds no temp path from a dot-prefixed literal', () => {
    // Catches a reintroduction that bypasses the constant entirely.
    const offenders = src.match(/`\.(tmp|part|mediadillo)[^`]*`/g) ?? []
    expect(offenders).toEqual([])
  })
})

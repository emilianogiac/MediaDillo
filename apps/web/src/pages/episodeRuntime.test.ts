import { describe, it, expect } from 'vitest'
import { formatRuntime, medianRuntime, isRuntimeOutlier } from './episodeRuntime.js'

describe('formatRuntime', () => {
  it('renders minutes under an hour', () => {
    expect(formatRuntime(22 * 60)).toBe('22m')
  })

  it('renders hours and minutes above an hour', () => {
    expect(formatRuntime(5400)).toBe('1h 30m')
  })

  it('renders seconds for a clip shorter than a minute', () => {
    expect(formatRuntime(42)).toBe('42s')
  })

  it('returns null for a missing or zero duration so callers can omit the badge', () => {
    expect(formatRuntime(null)).toBeNull()
    expect(formatRuntime(0)).toBeNull()
  })
})

describe('medianRuntime', () => {
  it('takes the middle value of an odd-length set', () => {
    expect(medianRuntime([1200, 1320, 1260])).toBe(1260)
  })

  it('averages the middle two of an even-length set', () => {
    expect(medianRuntime([1200, 1300, 1320, 1400])).toBe(1310)
  })

  it('ignores files with no duration yet', () => {
    expect(medianRuntime([1320, null, 1320, null, 1320])).toBe(1320)
  })

  it('returns null below three known runtimes, where a double-length file would skew the median', () => {
    expect(medianRuntime([1320, 2640])).toBeNull()
    expect(medianRuntime([1320])).toBeNull()
    expect(medianRuntime([])).toBeNull()
  })

  it('returns null when the median is too short to reason about', () => {
    expect(medianRuntime([20, 30, 40])).toBeNull()
  })
})

describe('isRuntimeOutlier', () => {
  const median = 22 * 60

  it('flags a double-length file as an outlier', () => {
    expect(isRuntimeOutlier(44 * 60, median)).toBe(true)
  })

  it('flags a short opening sequence as an outlier', () => {
    expect(isRuntimeOutlier(90, median)).toBe(true)
  })

  it('accepts ordinary variation around the median', () => {
    expect(isRuntimeOutlier(21 * 60, median)).toBe(false)
    expect(isRuntimeOutlier(25 * 60, median)).toBe(false)
  })

  it('does not flag anything without a usable median', () => {
    expect(isRuntimeOutlier(44 * 60, null)).toBe(false)
  })

  it('does not flag a file that has no duration', () => {
    expect(isRuntimeOutlier(null, median)).toBe(false)
    expect(isRuntimeOutlier(0, median)).toBe(false)
  })
})

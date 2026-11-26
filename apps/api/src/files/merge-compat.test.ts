import { describe, it, expect } from 'vitest'
import { assessMerge, verifyMergedOutput, type MediaProfile } from './merge-compat.js'

const profile = (over: Partial<MediaProfile> = {}): MediaProfile => ({
  container: '.mkv',
  videoCodec: 'hevc',
  width: 720,
  height: 304,
  audioCodec: 'ac3',
  audioChannels: 6,
  streamCount: 2,
  durationS: 50 * 60,
  ...over,
})

describe('assessMerge — duration classification (issue #77)', () => {
  it('accepts two genuine halves', () => {
    // The Town (2010): 62.9 + 61.8 against a 125 min runtime.
    const a = profile({ durationS: 62.9 * 60 })
    const b = profile({ durationS: 61.8 * 60 })
    const r = assessMerge(a, b, 125)
    expect(r.verdict).toBe('parts')
    expect(r.mergeable).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('refuses two complete copies of the same film', () => {
    // Sahara (2005): part1 3840x2160, part2 1920x1080, both 123.9 min against a
    // 124 min runtime. Merging would have produced the film twice, back to back.
    const a = profile({ durationS: 123.9 * 60, width: 3840, height: 2160 })
    const b = profile({ durationS: 123.9 * 60, width: 1920, height: 1080 })
    const r = assessMerge(a, b, 124)
    expect(r.verdict).toBe('versions')
    expect(r.mergeable).toBe(false)
    expect(r.reasons.join(' ')).toContain('two complete copies')
  })

  it('refuses a sample or trailer posing as a part', () => {
    // Five candidates were a 19s clip named _cd1/_cd2; two were a -trailer/-sample
    // that an earlier rename had relabelled as part1.
    const a = profile({ durationS: 19 })
    const b = profile({ durationS: 5577 })
    const r = assessMerge(a, b, 93)
    expect(r.verdict).toBe('junk')
    expect(r.mergeable).toBe(false)
    expect(r.reasons.join(' ')).toContain('sample or trailer')
  })

  it('accepts an extended edition whose halves exceed the TMDB runtime', () => {
    // TMDB stores the theatrical cut. All five LOTR candidates are extended editions:
    // Return of the King runs 263 min against TMDB's 201. Overshoot must not be a
    // reason to refuse, or every extended edition would be blocked.
    const a = profile({ durationS: 127.7 * 60 })
    const b = profile({ durationS: 135.6 * 60 })
    const r = assessMerge(a, b, 201)
    expect(r.verdict).toBe('parts')
    expect(r.mergeable).toBe(true)
  })

  it('refuses when the parts fall well short of the runtime', () => {
    const a = profile({ durationS: 20 * 60 })
    const b = profile({ durationS: 25 * 60 })
    const r = assessMerge(a, b, 125)
    expect(r.verdict).toBe('unknown')
    expect(r.mergeable).toBe(false)
    expect(r.reasons.join(' ')).toContain('footage missing')
  })

  it('refuses when the runtime is unknown, rather than guessing', () => {
    const r = assessMerge(profile(), profile(), null)
    expect(r.verdict).toBe('unknown')
    expect(r.mergeable).toBe(false)
  })

  it('refuses when a duration could not be read', () => {
    const r = assessMerge(profile({ durationS: 0 }), profile({ durationS: 0 }), 100)
    expect(r.mergeable).toBe(false)
  })
})

describe('assessMerge — stream compatibility (issue #77)', () => {
  const halfA = profile({ durationS: 60 * 60 })
  const halfB = profile({ durationS: 58 * 60 })

  it('refuses mismatched containers', () => {
    // LEGO DC Shazam (.mp4) was glued to LEGO Star Wars Christmas Special (.mkv).
    const r = assessMerge(halfA, { ...halfB, container: '.mp4' }, 118)
    expect(r.mergeable).toBe(false)
    expect(r.reasons.join(' ')).toContain('container')
  })

  it('refuses mismatched audio codecs', () => {
    // La ricerca della felicità: mp3 in one half, ac3 in the other.
    const r = assessMerge(halfA, { ...halfB, audioCodec: 'mp3' }, 118)
    expect(r.mergeable).toBe(false)
    expect(r.reasons.join(' ')).toContain('audio codec')
  })

  it('refuses a differing track count because tracks would be silently lost', () => {
    // LOTR Return of the King 4K: part1 has two extra English tracks (TrueHD + AC3)
    // that part2 lacks, so a concat drops them without saying so.
    const r = assessMerge({ ...halfA, streamCount: 9 }, { ...halfB, streamCount: 7 }, 118)
    expect(r.mergeable).toBe(false)
    expect(r.reasons.join(' ')).toContain('tracks would be lost')
  })

  it('refuses mismatched resolution, codec and channel count', () => {
    expect(assessMerge(halfA, { ...halfB, width: 640 }, 118).mergeable).toBe(false)
    expect(assessMerge(halfA, { ...halfB, videoCodec: 'h264' }, 118).mergeable).toBe(false)
    expect(assessMerge(halfA, { ...halfB, audioChannels: 2 }, 118).mergeable).toBe(false)
  })

  it('reports every mismatch at once, not just the first', () => {
    const r = assessMerge(halfA, { ...halfB, container: '.mp4', audioCodec: 'aac' }, 118)
    expect(r.reasons.length).toBeGreaterThanOrEqual(2)
  })
})

describe('verifyMergedOutput (issue #77)', () => {
  const a = profile({ durationS: 3600 })
  const b = profile({ durationS: 3480 })

  it('accepts output whose duration matches the sum of the parts', () => {
    expect(verifyMergedOutput(profile({ durationS: 7080 }), a, b)).toEqual({ ok: true })
  })

  it('rejects truncated output', () => {
    // The real failure mode: ffmpeg exits 0 on a bad -c copy concat and writes a file
    // that stops after the first segment.
    const r = verifyMergedOutput(profile({ durationS: 3600 }), a, b)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('differs from the expected')
  })

  it('rejects output with no video stream', () => {
    const r = verifyMergedOutput(profile({ durationS: 7080, videoCodec: null }), a, b)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('no video stream')
  })

  it('tolerates sub-1% drift from container overhead', () => {
    expect(verifyMergedOutput(profile({ durationS: 7080 * 1.005 }), a, b).ok).toBe(true)
  })
})

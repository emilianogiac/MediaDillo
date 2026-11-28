import { describe, it, expect } from 'vitest'
import { parseFfprobeOutput } from './ffprobe.js'

const h264_aac_1080p = {
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
    { codec_type: 'audio', codec_name: 'aac', channels: 2, channel_layout: 'stereo' },
  ],
}

const hevc_dts_4k_hdr = {
  streams: [
    {
      codec_type: 'video',
      codec_name: 'hevc',
      width: 3840,
      height: 2160,
      color_transfer: 'smpte2084',
      color_primaries: 'bt2020',
    },
    { codec_type: 'audio', codec_name: 'dts', channels: 6, channel_layout: '5.1' },
  ],
}

const truehd_atmos = {
  streams: [
    { codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080 },
    { codec_type: 'audio', codec_name: 'truehd', channels: 8, channel_layout: '7.1' },
  ],
}

describe('parseFfprobeOutput', () => {
  it('parses H.264 + AAC 1080p', () => {
    const r = parseFfprobeOutput(h264_aac_1080p)
    expect(r.videoCodec).toBe('H.264')
    expect(r.videoQualityTier).toBe('1080p')
    expect(r.videoResolution).toBe('1080p')
    expect(r.hdr).toBe(false)
    expect(r.audioCodec).toBe('AAC')
    expect(r.audioChannels).toBe('2.0')
    expect(r.audioQualityTier).toBe('stereo')
  })

  it('parses HEVC + DTS 4K HDR', () => {
    const r = parseFfprobeOutput(hevc_dts_4k_hdr)
    expect(r.videoCodec).toBe('H.265')
    expect(r.videoQualityTier).toBe('4K')
    expect(r.hdr).toBe(true)
    expect(r.audioCodec).toBe('DTS')
    expect(r.audioChannels).toBe('5.1')
    expect(r.audioQualityTier).toBe('surround')
  })

  it('detects TrueHD as lossless', () => {
    const r = parseFfprobeOutput(truehd_atmos)
    expect(r.audioCodec).toBe('TrueHD')
    expect(r.audioChannels).toBe('7.1')
    expect(r.audioQualityTier).toBe('lossless')
  })

  it('returns null specs for empty streams', () => {
    const r = parseFfprobeOutput({ streams: [] })
    expect(r.videoCodec).toBeNull()
    expect(r.audioCodec).toBeNull()
    expect(r.hdr).toBe(false)
  })

  it('handles missing streams key', () => {
    const r = parseFfprobeOutput({})
    expect(r.videoCodec).toBeNull()
  })
})

describe('parseFfprobeOutput — duration (issue #108)', () => {
  it('reads format.duration and rounds to whole seconds', () => {
    const r = parseFfprobeOutput({ ...h264_aac_1080p, format: { duration: '1327.613000' } })
    expect(r.durationS).toBe(1328)
  })

  it('falls back to the video stream duration when the container has none', () => {
    const r = parseFfprobeOutput({
      streams: [{ codec_type: 'video', codec_name: 'h264', height: 1080, duration: '113.173000' }],
    })
    expect(r.durationS).toBe(113)
  })

  it('falls back to the Matroska DURATION tag, which is a timecode not a number', () => {
    const r = parseFfprobeOutput({
      streams: [
        { codec_type: 'video', codec_name: 'h264', height: 1080, tags: { DURATION: '00:22:05.155000000' } },
      ],
    })
    expect(r.durationS).toBe(1325)
  })

  it('prefers format.duration over the stream fallbacks', () => {
    const r = parseFfprobeOutput({
      format: { duration: '600.0' },
      streams: [
        { codec_type: 'video', codec_name: 'h264', height: 1080, duration: '1.0', tags: { DURATION: '00:00:02.000000000' } },
      ],
    })
    expect(r.durationS).toBe(600)
  })

  it('skips a zero or unparseable duration rather than storing 0', () => {
    expect(parseFfprobeOutput({ ...h264_aac_1080p, format: { duration: '0.000000' } }).durationS).toBeNull()
    expect(parseFfprobeOutput({ ...h264_aac_1080p, format: { duration: 'N/A' } }).durationS).toBeNull()
    expect(parseFfprobeOutput({ ...h264_aac_1080p }).durationS).toBeNull()
  })

  it('ignores a DURATION tag that is not a timecode', () => {
    const r = parseFfprobeOutput({
      streams: [{ codec_type: 'video', codec_name: 'h264', height: 1080, tags: { DURATION: 'unknown' } }],
    })
    expect(r.durationS).toBeNull()
  })
})

/**
 * Issue #126 — resolution came from height alone, so every scope (2.39:1)
 * transfer was labelled 720p. All dimensions below are real files from the
 * Milan library; 34 of 45 sampled files were misclassified before this.
 */
describe('resolution tiering uses both dimensions (issue #126)', () => {
  function specsFor(width: number, height: number) {
    return parseFfprobeOutput({
      streams: [{ codec_type: 'video', codec_name: 'h264', width, height }],
    })
  }

  it.each([
    // scope transfers: full width, short height — the bug
    [1920, 800, '1080p', 'Animali fantastici / The Accountant / 14 others'],
    [1920, 816, '1080p', 'La mummia - Il ritorno'],
    [1920, 750, '1080p', 'Lilli e il vagabondo'],
    [1920, 796, '1080p', "Harry Potter e l'ordine della fenice"],
    [1918, 802, '1080p', 'Mayday (2026) — the reported case'],
    // a few pixels short of 1920: strict >= 1920 would miss these
    [1912, 1032, '1080p', 'Hammamet'],
    [1918, 1036, '1080p', 'Assassinio a Venezia'],
    // narrow 1080: height must carry it, width must not demote it
    [1436, 1080, '1080p', 'Lupin III Walther P38'],
    [1884, 1080, '1080p', 'Viaggi di nozze'],
    // genuine formats must be unaffected
    [1920, 1080, '1080p', 'standard 16:9 1080p'],
    [1280, 720, '720p', 'Osmosis Jones — genuinely 720p'],
    [720, 480, '480p', 'NTSC DVD'],
    [1024, 576, '576p', 'PAL widescreen'],
    // 4K, including the scope case one tier up
    [3840, 2160, '4K (2160p)', 'standard 4K'],
    [3840, 1606, '4K (2160p)', 'Sonic 2 - Il film (scope 4K)'],
    [3840, 2076, '4K (2160p)', 'Ritorno al futuro'],
  ])('%ix%i -> %s (%s)', (width, height, expected) => {
    expect(specsFor(width, height).videoResolution).toBe(expected)
  })

  it('maps the 4K label to the shorter quality tier', () => {
    const specs = specsFor(3840, 1606)
    expect(specs.videoResolution).toBe('4K (2160p)')
    expect(specs.videoQualityTier).toBe('4K')
  })

  it('falls back to height when width is absent', () => {
    const specs = parseFfprobeOutput({
      streams: [{ codec_type: 'video', codec_name: 'h264', height: 1080 }],
    })
    expect(specs.videoResolution).toBe('1080p')
  })

  it('falls back to width when height is absent', () => {
    const specs = parseFfprobeOutput({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920 }],
    })
    expect(specs.videoResolution).toBe('1080p')
  })

  it('returns null when neither dimension is reported', () => {
    const specs = parseFfprobeOutput({
      streams: [{ codec_type: 'video', codec_name: 'h264' }],
    })
    expect(specs.videoResolution).toBeNull()
    expect(specs.videoQualityTier).toBeNull()
  })

  it('does not promote genuinely small content', () => {
    expect(specsFor(640, 360).videoResolution).toBe('360p')
    expect(specsFor(320, 240).videoResolution).toBe('SD')
  })
})

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

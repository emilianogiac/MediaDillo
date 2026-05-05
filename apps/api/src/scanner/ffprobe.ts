import { spawn } from 'node:child_process'
import type { VideoTechSpecs } from './types.js'

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  color_transfer?: string
  color_primaries?: string
  color_space?: string
  channels?: number
  channel_layout?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
}

export async function extractTechSpecs(filePath: string): Promise<VideoTechSpecs> {
  try {
    const raw = await runFfprobe(filePath)
    return parseFfprobeOutput(raw)
  } catch {
    return nullSpecs()
  }
}

async function runFfprobe(filePath: string): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      filePath,
    ])

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}: ${stderr}`))
        return
      }
      try {
        resolve(JSON.parse(stdout) as FfprobeOutput)
      } catch {
        reject(new Error('Failed to parse ffprobe JSON output'))
      }
    })

    proc.on('error', reject)
  })
}

export function parseFfprobeOutput(data: FfprobeOutput): VideoTechSpecs {
  const streams = data.streams ?? []

  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')

  const videoCodec = normalizeVideoCodec(video?.codec_name ?? null)
  const height = video?.height ?? null
  const videoResolution = height ? resolveResolutionLabel(height) : null
  const videoQualityTier = height ? resolveQualityTier(height) : null
  const hdr = detectHdr(video)

  const audioCodec = normalizeAudioCodec(audio?.codec_name ?? null)
  const audioChannels = resolveChannelLayout(audio)
  const audioQualityTier = resolveAudioQualityTier(audioCodec)

  return { videoCodec, videoResolution, videoQualityTier, hdr, audioCodec, audioChannels, audioQualityTier }
}

function normalizeVideoCodec(raw: string | null): string | null {
  if (!raw) return null
  const map: Record<string, string> = {
    h264: 'H.264', avc: 'H.264',
    hevc: 'H.265', h265: 'H.265',
    av1: 'AV1',
    vp9: 'VP9',
    mpeg4: 'MPEG-4',
    mpeg2video: 'MPEG-2',
    xvid: 'XviD',
    divx: 'DivX',
  }
  return map[raw.toLowerCase()] ?? raw.toUpperCase()
}

function normalizeAudioCodec(raw: string | null): string | null {
  if (!raw) return null
  const map: Record<string, string> = {
    aac: 'AAC',
    ac3: 'AC3',
    eac3: 'EAC3',
    dts: 'DTS',
    'dts-hd': 'DTS-HD',
    truehd: 'TrueHD',
    mp3: 'MP3',
    opus: 'Opus',
    flac: 'FLAC',
    pcm_s16le: 'PCM',
    pcm_s24le: 'PCM',
  }
  return map[raw.toLowerCase()] ?? raw.toUpperCase()
}

function resolveResolutionLabel(height: number): string {
  if (height >= 2160) return '4K (2160p)'
  if (height >= 1080) return '1080p'
  if (height >= 720) return '720p'
  return 'SD'
}

function resolveQualityTier(height: number): string {
  if (height >= 2160) return '4K'
  if (height >= 1080) return '1080p'
  if (height >= 720) return '720p'
  return 'SD'
}

function detectHdr(stream: FfprobeStream | undefined): boolean {
  if (!stream) return false
  const { color_transfer, color_primaries, color_space } = stream
  const hdrTransfers = ['smpte2084', 'arib-std-b67', 'smpte428']
  const hdrPrimaries = ['bt2020']
  return (
    hdrTransfers.some((t) => color_transfer?.toLowerCase().includes(t)) ||
    hdrPrimaries.some((p) => color_primaries?.toLowerCase().includes(p)) ||
    color_space?.toLowerCase().includes('bt2020') === true
  )
}

function resolveChannelLayout(audio: FfprobeStream | undefined): string | null {
  if (!audio) return null
  if (audio.channel_layout) {
    const map: Record<string, string> = {
      stereo: '2.0',
      '5.1': '5.1',
      '5.1(side)': '5.1',
      '7.1': '7.1',
      mono: '1.0',
    }
    return map[audio.channel_layout] ?? audio.channel_layout
  }
  if (audio.channels) {
    const chMap: Record<number, string> = { 1: '1.0', 2: '2.0', 6: '5.1', 8: '7.1' }
    return chMap[audio.channels] ?? `${audio.channels}ch`
  }
  return null
}

function resolveAudioQualityTier(codec: string | null): string | null {
  if (!codec) return null
  const lossless = ['TrueHD', 'DTS-HD', 'FLAC', 'PCM']
  const surroundLossy = ['DTS', 'AC3', 'EAC3']
  if (lossless.includes(codec)) return 'lossless'
  if (surroundLossy.includes(codec)) return 'surround'
  return 'stereo'
}

function nullSpecs(): VideoTechSpecs {
  return {
    videoCodec: null, videoResolution: null, videoQualityTier: null, hdr: false,
    audioCodec: null, audioChannels: null, audioQualityTier: null,
  }
}

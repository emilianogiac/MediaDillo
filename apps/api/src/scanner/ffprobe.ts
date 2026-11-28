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
  duration?: string
  tags?: Record<string, string>
}

interface FfprobeFormat {
  duration?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
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
      '-show_format',
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
  const width = video?.width ?? null
  const tier = resolveTierIndex(width, height)
  const videoResolution = tier === null ? null : RESOLUTION_LABELS[tier]!
  const videoQualityTier = tier === null ? null : QUALITY_TIERS[tier]!
  const hdr = detectHdr(video)

  const audioCodec = normalizeAudioCodec(audio?.codec_name ?? null)
  const audioChannels = resolveChannelLayout(audio)
  const audioQualityTier = resolveAudioQualityTier(audioCodec)

  return { durationS: resolveDurationS(data, video), videoCodec, videoResolution, videoQualityTier, hdr, audioCodec, audioChannels, audioQualityTier }
}

/**
 * Container duration in whole seconds, from the cheapest source that has it.
 *
 * `format.duration` is absent on some AVI/MPEG rips and never set on the Matroska
 * video stream, which carries the figure in a `DURATION` tag instead — hence three
 * sources rather than one. This is the header value: cheap, and good enough to tell a
 * 22-minute slot from a 70-minute one. Merge verification needs more precision than a
 * header can promise and reads the last video packet itself (see `probeMedia`).
 */
function resolveDurationS(data: FfprobeOutput, video: FfprobeStream | undefined): number | null {
  const candidates = [
    parseSeconds(data.format?.duration),
    parseSeconds(video?.duration),
    parseTimecode(video?.tags?.['DURATION'] ?? video?.tags?.['duration']),
  ]
  const seconds = candidates.find((c) => c !== null && c > 0)
  return seconds === undefined || seconds === null ? null : Math.round(seconds)
}

function parseSeconds(raw: string | undefined): number | null {
  if (!raw) return null
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

/** Matroska writes `HH:MM:SS.nnnnnnnnn` in the stream's DURATION tag. */
function parseTimecode(raw: string | undefined): number | null {
  if (!raw) return null
  const m = /^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/.exec(raw.trim())
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number.parseFloat(m[3]!)
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

/** Index 0..7, shared by both vocabularies below. */
const RESOLUTION_LABELS = ['SD', '360p', '480p', '576p', '720p', '1080p', '1440p', '4K (2160p)'] as const
const QUALITY_TIERS = ['SD', '360p', '480p', '576p', '720p', '1080p', '1440p', '4K'] as const

/** Minimum height per tier index, highest first. */
const MIN_HEIGHT: readonly [number, number][] = [
  [2160, 7], [1440, 6], [1080, 5], [720, 4], [576, 3], [480, 2], [360, 1],
]

/**
 * Minimum width per tier index, for 720p and above only.
 *
 * Thresholds sit below each format's nominal width (3840 / 2560 / 1920 / 1280)
 * because real encodes come in a few pixels short — both 1912 and 1918 occur in
 * this library — so a strict `>= 1920` test would still miss them.
 *
 * Deliberately stops at 720p: below HD, width cannot identify a format. 640 is
 * the width of both `640x480` (480p) and `640x360` (360p), so extending this
 * table downwards would promote 360p content to 480p. Scope transfers, the
 * reason width is consulted at all, only exist at HD and above — so height
 * decides on its own below that.
 */
const MIN_WIDTH: readonly [number, number][] = [
  [3400, 7], [2300, 6], [1700, 5], [1100, 4],
]

function indexFrom(value: number, table: readonly [number, number][]): number {
  for (const [min, index] of table) {
    if (value >= min) return index
  }
  return 0
}

/**
 * Resolution tier from both dimensions, taking whichever is better (#126).
 *
 * Height alone misreads every scope transfer: 1920x800 is 1080p-class material
 * but `800 >= 1080` is false, so it was labelled `720p` — on this library that
 * affected 30 of 33 sampled files. Width alone is equally wrong, because a
 * narrow 1080 transfer such as 1436x1080 would be demoted. Either dimension
 * reaching a tier is sufficient evidence for it.
 */
function resolveTierIndex(width: number | null, height: number | null): number | null {
  if (!width && !height) return null
  return Math.max(
    height ? indexFrom(height, MIN_HEIGHT) : 0,
    width ? indexFrom(width, MIN_WIDTH) : 0,
  )
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
    durationS: null,
    videoCodec: null, videoResolution: null, videoQualityTier: null, hdr: false,
    audioCodec: null, audioChannels: null, audioQualityTier: null,
  }
}

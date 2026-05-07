export interface VideoTechSpecs {
  videoCodec: string | null
  videoResolution: string | null
  videoQualityTier: string | null
  hdr: boolean
  audioCodec: string | null
  audioChannels: string | null
  audioQualityTier: string | null
}

export interface ParsedMovie {
  type: 'movie'
  title: string
  year: number | null
  edition: string | null
}

export interface ParsedEpisode {
  type: 'tv'
  show: string
  year: number | null
  season: number
  episodes: number[]
  episodeTitle: string | null
}

export type ParsedFilename = ParsedMovie | ParsedEpisode

export interface ScannedFile {
  path: string
  sizeBytes: bigint
  mtimeMs: number
  parsed: ParsedFilename
  techSpecs: VideoTechSpecs
}

export interface ScanSummary {
  scanLogId: string
  filesAdded: number
  filesChanged: number
  filesRemoved: number
  staleFilesFound: number
  durationMs: number
}

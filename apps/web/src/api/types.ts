export type QualityTier = 'SD' | '720p' | '1080p' | '4K'

export interface ScanRoot {
  id: string
  label: string
  type: 'movies' | 'tv'
  path: string
}

export interface MovieSummary {
  id: string
  title: string
  year: number | null
  posterUrl: string | null
  genres: string[]
  rating: number | null
  runtime: number | null
  tmdbId: number | null
  posterDownloaded: boolean
  backdropDownloaded: boolean
  status: string
  scanRoot: { id: string; label: string } | null
  files: { videoQualityTier: string | null }[]
}

export interface MovieFile {
  id: string
  path: string
  sizeBytes: bigint | number | null
  durationS: number | null
  videoCodec: string | null
  videoResolution: string | null
  videoQualityTier: string | null
  hdr: boolean
  audioCodec: string | null
  audioChannels: string | null
  audioQualityTier: string | null
}

export interface Person {
  id: string
  name: string
  profileUrl: string | null
}

export interface Credit {
  id: string
  role: 'CAST' | 'DIRECTOR' | 'WRITER'
  character: string | null
  person: Person
}

export interface MovieDetail extends Omit<MovieSummary, 'files'> {
  imdbId: string | null
  overview: string | null
  tagline: string | null
  backdropUrl: string | null
  scanRoot: { id: string; label: string; path: string } | null
  files: MovieFile[]
  credits: Credit[]
}

export interface ImageCandidate {
  filePath: string
  url: string
  width: number
  height: number
  language: string | null
  voteAverage: number
}

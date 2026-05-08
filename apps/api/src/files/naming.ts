const INVALID_CHARS = /[/\\:*?"<>|]/g
const MULTI_SPACE = /\s{2,}/g

export function sanitizeForFilename(str: string): string {
  return str.replace(INVALID_CHARS, '').replace(MULTI_SPACE, ' ').trim()
}

export function canonicalMovieFolderName(title: string, year: number | null): string {
  const t = sanitizeForFilename(title)
  return year ? `${t} (${year})` : t
}

export function canonicalMovieFileName(
  title: string,
  year: number | null,
  ext: string,
  partNumber: number | null = null,
  edition: string | null = null,
): string {
  const base = canonicalMovieFolderName(title, year)
  const part = partNumber !== null ? ` - part${partNumber}` : ''
  const ed = edition ? ` {edition-${edition}}` : ''
  return `${base}${part}${ed}${ext}`
}

export function canonicalSeasonFolderName(seasonNumber: number): string {
  return `Season ${String(seasonNumber).padStart(2, '0')}`
}

export function canonicalEpisodeFileName(
  showTitle: string,
  seasonNumber: number,
  episodeStart: number,
  episodeTitle: string | null,
  ext: string,
  episodeEnd: number | null = null,
  partNumber: number | null = null,
): string {
  const s = String(seasonNumber).padStart(2, '0')
  const eStart = String(episodeStart).padStart(2, '0')
  let code = `S${s}E${eStart}`
  if (episodeEnd !== null && episodeEnd > episodeStart) {
    code += `E${String(episodeEnd).padStart(2, '0')}`
  }
  const show = sanitizeForFilename(showTitle)
  const partSuffix = partNumber !== null ? ` - part${partNumber}` : ''
  if (episodeTitle) {
    const title = sanitizeForFilename(episodeTitle)
    return `${show} - ${code} - ${title}${partSuffix}${ext}`
  }
  return `${show} - ${code}${partSuffix}${ext}`
}

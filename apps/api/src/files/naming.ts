const INVALID_CHARS = /[/\\:*?"<>|@!]/g
const MULTI_SPACE = /\s{2,}/g
const LEADING_DOTS = /^\.+\s*/

// Map typographic/Unicode chars to plain ASCII equivalents before stripping.
// This avoids backup-tool failures on ellipsis, smart quotes, dashes, etc.
const TYPOGRAPHIC_MAP: [RegExp, string][] = [
  [/…/g, '...'],      // … ellipsis
  [/[–—]/g, '-'], // – en dash, — em dash
  [/[‘’ʼ]/g, "'"], // ' ' ʼ curly/modifier apostrophes
  [/[“”]/g, '"'], // " " curly double quotes
  [/½/g, ''],          // ½ fraction (8½ → 8)
  [/ª/g, 'a'],         // ª feminine ordinal
  [/º/g, 'o'],         // º masculine ordinal
]

export function sanitizeForFilename(str: string): string {
  // NFD decomposes accented letters into base + combining mark (e.g. è → e + ̀),
  // then we strip all combining marks, giving plain ASCII letters for free.
  let s = str.normalize('NFD').replace(/\p{Mn}/gu, '')
  for (const [pattern, replacement] of TYPOGRAPHIC_MAP) {
    s = s.replace(pattern, replacement)
  }
  return s.replace(INVALID_CHARS, '').replace(MULTI_SPACE, ' ').replace(LEADING_DOTS, '').trim()
}

export function canonicalMovieFolderName(title: string, year: number | null): string {
  const t = sanitizeForFilename(title)
  return year ? `${t} (${year})` : t
}

const THREE_D_LABELS: Record<string, string> = {
  sbs: '3D SBS',
  ou: '3D OU',
  full_sbs: '3D Full-SBS',
  unknown: '3D',
}

export function canonicalMovieFileName(
  title: string,
  year: number | null,
  ext: string,
  partNumber: number | null = null,
  edition: string | null = null,
  threeD: string | null = null,
): string {
  const base = canonicalMovieFolderName(title, year)
  const part = partNumber !== null ? ` - part${partNumber}` : ''
  const td = threeD ? ` - ${THREE_D_LABELS[threeD] ?? '3D'}` : ''
  const ed = edition ? ` {edition-${edition}}` : ''
  return `${base}${part}${td}${ed}${ext}`
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

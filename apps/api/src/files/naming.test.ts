import { describe, it, expect } from 'vitest'
import {
  canonicalEpisodeFileName,
  canonicalMovieFileName,
  canonicalMovieFolderName,
  canonicalSeasonFolderName,
  isShowFolderCanonical,
  sanitizeForFilename,
} from './naming.js'

describe('sanitizeForFilename', () => {
  it('removes invalid characters', () => {
    expect(sanitizeForFilename('Hello: World/Test')).toBe('Hello World/Test'.replace('/', ''))
    expect(sanitizeForFilename('AC/DC: Back in Black')).toBe('ACDC Back in Black')
  })

  it('collapses multiple spaces', () => {
    expect(sanitizeForFilename('hello  world')).toBe('hello world')
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeForFilename('  hello  ')).toBe('hello')
  })

  it('removes all invalid chars', () => {
    const chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|', '@', '!']
    for (const c of chars) {
      expect(sanitizeForFilename(`a${c}b`)).toBe('ab')
    }
  })

  it('strips accented letters to plain ASCII', () => {
    expect(sanitizeForFilename('Adèle')).toBe('Adele')
    expect(sanitizeForFilename('caffè')).toBe('caffe')
    expect(sanitizeForFilename('città')).toBe('citta')
  })

  it('normalizes typographic characters to ASCII', () => {
    expect(sanitizeForFilename("C’era una volta a… Hollywood")).toBe("C'era una volta a... Hollywood")
    expect(sanitizeForFilename('Jurassic World – Il regno distrutto')).toBe('Jurassic World - Il regno distrutto')
    expect(sanitizeForFilename('8½')).toBe('8')
    expect(sanitizeForFilename('Shazam!')).toBe('Shazam')
    expect(sanitizeForFilename("C’è post@ per te")).toBe("C'e post per te")
  })
})

describe('canonicalMovieFolderName', () => {
  it('includes year when present', () => {
    expect(canonicalMovieFolderName('Inception', 2010)).toBe('Inception (2010)')
  })

  it('omits year when null', () => {
    expect(canonicalMovieFolderName('Unknown', null)).toBe('Unknown')
  })

  it('sanitizes title', () => {
    expect(canonicalMovieFolderName('Batman: Begins', 2005)).toBe('Batman Begins (2005)')
  })
})

describe('canonicalMovieFileName', () => {
  it('appends extension', () => {
    expect(canonicalMovieFileName('Dune', 2021, '.mkv')).toBe('Dune (2021).mkv')
  })

  it('no year', () => {
    expect(canonicalMovieFileName('Dune', null, '.mp4')).toBe('Dune.mp4')
  })

  it('includes edition token when provided', () => {
    expect(canonicalMovieFileName('The Godfather', 1972, '.mkv', null, "Director's Cut")).toBe(
      "The Godfather (1972) {edition-Director's Cut}.mkv",
    )
  })

  it('edition token placed after part suffix', () => {
    expect(canonicalMovieFileName('The Godfather', 1972, '.mkv', 1, "Extended")).toBe(
      'The Godfather (1972) - part1 {edition-Extended}.mkv',
    )
  })

  it('omits edition token when null', () => {
    expect(canonicalMovieFileName('Dune', 2021, '.mkv', null, null)).toBe('Dune (2021).mkv')
  })

  it('includes 3D SBS suffix', () => {
    expect(canonicalMovieFileName('Avatar', 2009, '.mkv', null, null, 'sbs')).toBe('Avatar (2009) - 3D SBS.mkv')
  })

  it('includes 3D OU suffix', () => {
    expect(canonicalMovieFileName('Avatar', 2009, '.mkv', null, null, 'ou')).toBe('Avatar (2009) - 3D OU.mkv')
  })

  it('includes 3D Full-SBS suffix', () => {
    expect(canonicalMovieFileName('Avatar', 2009, '.mkv', null, null, 'full_sbs')).toBe('Avatar (2009) - 3D Full-SBS.mkv')
  })

  it('includes generic 3D suffix', () => {
    expect(canonicalMovieFileName('Avatar', 2009, '.mkv', null, null, 'unknown')).toBe('Avatar (2009) - 3D.mkv')
  })

  it('places 3D before edition token', () => {
    expect(canonicalMovieFileName('Avatar', 2009, '.mkv', null, "Extended", 'sbs')).toBe(
      "Avatar (2009) - 3D SBS {edition-Extended}.mkv",
    )
  })
})

describe('canonicalSeasonFolderName', () => {
  it('zero-pads single digit', () => {
    expect(canonicalSeasonFolderName(1)).toBe('Season 01')
    expect(canonicalSeasonFolderName(9)).toBe('Season 09')
  })

  it('no padding needed for double digit', () => {
    expect(canonicalSeasonFolderName(10)).toBe('Season 10')
  })
})

describe('canonicalEpisodeFileName', () => {
  it('includes episode title', () => {
    expect(canonicalEpisodeFileName('Breaking Bad', 1, 1, 'Pilot', '.mkv')).toBe(
      'Breaking Bad - S01E01 - Pilot.mkv',
    )
  })

  it('omits episode title when null', () => {
    expect(canonicalEpisodeFileName('The Wire', 2, 5, null, '.mkv')).toBe(
      'The Wire - S02E05.mkv',
    )
  })

  it('zero-pads season and episode', () => {
    expect(canonicalEpisodeFileName('Chernobyl', 1, 1, null, '.mkv')).toBe(
      'Chernobyl - S01E01.mkv',
    )
  })

  it('sanitizes show title with colon', () => {
    expect(canonicalEpisodeFileName('Star Trek: Discovery', 1, 1, 'Vulcan Hello', '.mkv')).toBe(
      'Star Trek Discovery - S01E01 - Vulcan Hello.mkv',
    )
  })
})

describe('sanitizeForFilename — non-ASCII symbols and punctuation (issue #69)', () => {
  it('maps the bullet used in TMDB titles to a hyphen', () => {
    // MediaDillo itself renamed "WALL-E (2008)" to "WALL•E (2008)" on the Milan
    // library, taking the bullet straight from the TMDB title.
    expect(sanitizeForFilename('WALL•E')).toBe('WALL-E')
    expect(canonicalMovieFolderName('WALL•E', 2008)).toBe('WALL-E (2008)')
  })

  it('maps the middot family to a hyphen', () => {
    expect(sanitizeForFilename('A·B')).toBe('A-B')
    expect(sanitizeForFilename('A∙B')).toBe('A-B')
    expect(sanitizeForFilename('A‧B')).toBe('A-B')
  })

  it('drops the degree sign', () => {
    expect(sanitizeForFilename('Il 13° guerriero')).toBe('Il 13 guerriero')
  })

  it('drops unenumerated non-ASCII symbols and punctuation', () => {
    expect(sanitizeForFilename('Trade™ Mark')).toBe('Trade Mark')
    expect(sanitizeForFilename('Copy© Right')).toBe('Copy Right')
    expect(sanitizeForFilename('Price €50')).toBe('Price 50')
    expect(sanitizeForFilename('Café « Paris »')).toBe('Cafe Paris')
  })

  it('preserves non-Latin letters rather than emptying the name', () => {
    // Stripping all non-ASCII would reduce these to '', which is worse than a
    // non-ASCII letter: the file would lose its name entirely.
    expect(sanitizeForFilename('七人の侍')).toBe('七人の侍')
    expect(sanitizeForFilename('Сталкер')).toBe(
      'Сталкер'
    )
  })

  it('keeps the previously mapped characters working', () => {
    expect(sanitizeForFilename('And Just Like That…')).toBe('And Just Like That...')
    expect(sanitizeForFilename('Jurassic World – Il regno distrutto')).toBe(
      'Jurassic World - Il regno distrutto'
    )
    expect(sanitizeForFilename('L’avventura')).toBe("L'avventura")
    expect(sanitizeForFilename('8½')).toBe('8')
    expect(sanitizeForFilename('La 25ª ora')).toBe('La 25a ora')
  })

  it('leaves no non-ASCII symbol or punctuation in any real library title', () => {
    // Generic invariant so the fix cannot regress one character at a time.
    const titles = [
      'WALL•E',
      'Il 13° guerriero',
      'And Just Like That…',
      'C’era una volta a… Hollywood',
      'Jurassic World – Il regno distrutto',
      'Scooby-Doo! – 13 Casi da Brivido In Giro Per Il Mondo',
      'Riverdance - L’avventura animata',
      '8½',
      'La 25ª ora',
      'Il miracolo della 34ª strada',
      'Adèle e l’enigma del faraone',
      'Easy Rider - Libertà e paura',
    ]
    for (const title of titles) {
      const out = sanitizeForFilename(title)
      const leaked = [...out].filter((ch) => ch.charCodeAt(0) > 127)
      expect(leaked, `leaked from ${JSON.stringify(title)}: ${JSON.stringify(leaked)}`).toEqual([])
    }
  })
})

/**
 * Issue #109.
 *
 * "Organized" was derived in two places and meant two different things: the
 * shows list compared the folder name, `GET /shows/:id` hardcoded `false`, and
 * the show page's badge looked at pending episode renames while discarding the
 * pending folder rename. A show could read "✓ Organized" on its own page and
 * sit in the unorganized bucket on the list.
 */
describe('isShowFolderCanonical (issue #109)', () => {
  it('accepts a folder that already matches Title (Year)', () => {
    expect(isShowFolderCanonical('/mnt/nas/serie_tv/Conte Dacula (1988)', 'Conte Dacula', 1988, true)).toBe(true)
  })

  it('rejects the underscored folder that looked organized on the show page', () => {
    expect(isShowFolderCanonical('/mnt/nas/cartoni_tv/Conte_Dacula_(1988)', 'Conte Dacula', 1988, true)).toBe(false)
  })

  it('rejects a folder named from a different title', () => {
    expect(
      isShowFolderCanonical('/mnt/nas/serie_tv/It (1990)', 'IT - Il pagliaccio assassino', 1990, true),
    ).toBe(false)
  })

  it('is never organized without a provider id — there is no canonical name to match', () => {
    expect(isShowFolderCanonical('/mnt/nas/serie_tv/Conte Dacula (1988)', 'Conte Dacula', 1988, false)).toBe(false)
  })

  it('is not organized when the folder is unknown', () => {
    expect(isShowFolderCanonical(null, 'Conte Dacula', 1988, true)).toBe(false)
    expect(isShowFolderCanonical(undefined, 'Conte Dacula', 1988, true)).toBe(false)
  })

  it('tolerates a trailing slash on the folder path', () => {
    expect(isShowFolderCanonical('/mnt/nas/serie_tv/Fringe (2008)/', 'Fringe', 2008, true)).toBe(true)
  })

  it('handles a show with no year', () => {
    expect(isShowFolderCanonical('/mnt/nas/serie_tv/Unknown', 'Unknown', null, true)).toBe(true)
  })

  it('applies the same sanitising as the folder namer, so a colon still matches', () => {
    expect(
      isShowFolderCanonical('/mnt/nas/serie_tv/Star Trek The Next Generation (1987)',
        'Star Trek: The Next Generation', 1987, true),
    ).toBe(true)
  })
})

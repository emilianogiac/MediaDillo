import { describe, it, expect } from 'vitest'
import {
  BATCH_SAFE_TO_DELETE,
  categorizeFolderFile,
  type FolderFileCategory,
} from './cleanup-categories.js'

/**
 * Issue #75: BATCH_SAFE_TO_DELETE drives an UNATTENDED delete that runs as a side
 * effect of matching a movie to TMDB. Anything in this set is removed without the user
 * being asked, so its contents are a safety boundary, not a convenience list.
 */
describe('BATCH_SAFE_TO_DELETE (issue #75)', () => {
  it('never auto-deletes subtitles', () => {
    // Previously included. With match.autoCleanupFolder enabled this permanently
    // deleted every subtitle in a movie's folder on each match — on the Milan library
    // that was all five subtitles that exist, including PGS tracks rescued by hand.
    expect(BATCH_SAFE_TO_DELETE.has('subtitle')).toBe(false)
  })

  it('never auto-deletes an unrecognised video', () => {
    // A video the scanner has not recorded yet — just copied in, a new part, another
    // edition — must survive a match that happens before the next scan.
    expect(BATCH_SAFE_TO_DELETE.has('unknown-video')).toBe(false)
  })

  it('never auto-deletes the film or its canonical metadata', () => {
    for (const c of ['video', 'artwork', 'nfo'] as FolderFileCategory[]) {
      expect(BATCH_SAFE_TO_DELETE.has(c), c).toBe(false)
    }
  })

  it('still auto-deletes superseded artwork, foreign NFOs and non-media junk', () => {
    // The fix must not make cleanup useless.
    for (const c of ['extra-art', 'extra-nfo', 'unknown'] as FolderFileCategory[]) {
      expect(BATCH_SAFE_TO_DELETE.has(c), c).toBe(true)
    }
  })

  it('contains exactly the three intended categories', () => {
    // Pins the set so a future addition has to be deliberate.
    expect([...BATCH_SAFE_TO_DELETE].sort()).toEqual(['extra-art', 'extra-nfo', 'unknown'])
  })
})

describe('categorizeFolderFile (issue #75)', () => {
  const CANON = 'Some Movie (1999).nfo'

  it('classifies a subtitle as subtitle, never as deletable junk', () => {
    for (const ext of ['.srt', '.sub', '.idx', '.sup', '.ass', '.ssa', '.vtt', '.mks']) {
      const cat = categorizeFolderFile(`Some Movie (1999).eng${ext}`, false, CANON)
      expect(cat, ext).toBe('subtitle')
      expect(BATCH_SAFE_TO_DELETE.has(cat), ext).toBe(false)
    }
  })

  it('classifies an unrecorded video as unknown-video, not unknown', () => {
    // The distinction is the whole point: 'unknown' is auto-deletable, a video is not.
    const cat = categorizeFolderFile('Some Movie (1999) - part2.mkv', false, CANON)
    expect(cat).toBe('unknown-video')
    expect(BATCH_SAFE_TO_DELETE.has(cat)).toBe(false)
  })

  it('classifies a recorded video as video', () => {
    expect(categorizeFolderFile('Some Movie (1999).mkv', true, CANON)).toBe('video')
  })

  it('classifies canonical artwork as artwork', () => {
    for (const n of ['poster.jpg', 'backdrop.jpg', 'folder.jpg', 'logo.png', 'fanart.jpg']) {
      expect(categorizeFolderFile(n, false, CANON), n).toBe('artwork')
    }
  })

  it('classifies suffixed leftovers as extra-art and loose images as unknown', () => {
    expect(categorizeFolderFile('Some Movie-poster.jpg', false, CANON)).toBe('extra-art')
    expect(categorizeFolderFile('Some Movie_landscape.jpg', false, CANON)).toBe('extra-art')
    expect(categorizeFolderFile('screenshot.png', false, CANON)).toBe('unknown')
  })

  it('distinguishes the canonical NFO from a foreign one', () => {
    expect(categorizeFolderFile('movie.nfo', false, CANON)).toBe('nfo')
    expect(categorizeFolderFile(CANON, false, CANON)).toBe('nfo')
    expect(categorizeFolderFile('tmm-leftover.nfo', false, CANON)).toBe('extra-nfo')
  })

  it('is case-insensitive about extensions and artwork names', () => {
    expect(categorizeFolderFile('Movie.ENG.SRT', false, CANON)).toBe('subtitle')
    expect(categorizeFolderFile('POSTER.JPG', false, CANON)).toBe('artwork')
    expect(categorizeFolderFile('Movie.MKV', false, CANON)).toBe('unknown-video')
  })

  it('does not auto-delete the real subtitles present on the Milan library', () => {
    for (const n of [
      'Scooby-Doo & Batman Il caso irrisolto (2018).eng.srt',
      'Animali fantastici - I crimini di Grindelwald (2018).eng.sup',
      'Animali fantastici - I crimini di Grindelwald (2018).spa.sup',
    ]) {
      expect(BATCH_SAFE_TO_DELETE.has(categorizeFolderFile(n, false, CANON)), n).toBe(false)
    }
  })
})

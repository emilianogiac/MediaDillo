import { describe, it, expect } from 'vitest'
import {
  sanitizeForFilename,
  canonicalMovieFolderName,
  canonicalMovieFileName,
  canonicalSeasonFolderName,
  canonicalEpisodeFileName,
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
    const chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']
    for (const c of chars) {
      expect(sanitizeForFilename(`a${c}b`)).toBe('ab')
    }
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

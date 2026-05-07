import { describe, it, expect } from 'vitest'
import { parseFilename } from './filename-parser.js'

describe('parseFilename — movies', () => {
  it('parses clean Jellyfin format', () => {
    const r = parseFilename('/mnt/nas/film/The Godfather (1972)/The Godfather (1972).mkv')
    expect(r).toMatchObject({ type: 'movie', title: 'The Godfather', year: 1972 })
  })

  it('parses title without year', () => {
    const r = parseFilename('/film/Casablanca.mkv')
    expect(r).toMatchObject({ type: 'movie', title: 'Casablanca', year: null })
  })

  it('parses dot-separated filename (year as part of title — no parens)', () => {
    // Without (YEAR) parens we can't safely split year from title like "Blade Runner 2049"
    // TMDB matching in Epic 3 handles this via search
    const r = parseFilename('/film/The.Dark.Knight.2008.mkv')
    expect(r).toMatchObject({ type: 'movie', title: 'The Dark Knight 2008', year: null })
  })

  it('strips quality noise tags', () => {
    const r = parseFilename('/film/Inception (2010) [1080p].mkv')
    expect(r).toMatchObject({ type: 'movie', title: 'Inception', year: 2010 })
  })

  it('parses underscore-separated filename', () => {
    const r = parseFilename('/film/Blade_Runner_2049.mkv')
    expect(r).toMatchObject({ type: 'movie', title: 'Blade Runner 2049', year: null })
  })
})

describe('parseFilename — movie editions', () => {
  it('parses edition token', () => {
    const r = parseFilename('/film/The Godfather (1972)/The Godfather (1972) {edition-Director\'s Cut}.mkv')
    expect(r).toMatchObject({ type: 'movie', title: 'The Godfather', year: 1972, edition: "Director's Cut" })
  })

  it('parses edition token without year', () => {
    const r = parseFilename('/film/Casablanca {edition-Restored}.mkv')
    expect(r).toMatchObject({ type: 'movie', title: 'Casablanca', year: null, edition: 'Restored' })
  })

  it('returns null edition when token absent', () => {
    const r = parseFilename('/film/The Godfather (1972)/The Godfather (1972).mkv')
    expect(r).toMatchObject({ type: 'movie', title: 'The Godfather', year: 1972, edition: null })
  })

  it('strips edition token before extracting title and year', () => {
    const r = parseFilename('/film/Blade Runner 2049 (2017) {edition-Extended Cut}.mkv')
    expect(r).toMatchObject({ type: 'movie', title: 'Blade Runner 2049', year: 2017, edition: 'Extended Cut' })
  })
})

describe('parseFilename — TV shows', () => {
  it('parses standard Jellyfin S/E format', () => {
    const r = parseFilename('/tv/Breaking Bad/Season 01/Breaking Bad - S01E01 - Pilot.mkv')
    expect(r).toMatchObject({
      type: 'tv',
      show: 'Breaking Bad',
      season: 1,
      episodes: [1],
      episodeTitle: 'Pilot',
    })
  })

  it('parses dot-separated TV filename', () => {
    const r = parseFilename('/tv/Breaking.Bad.S03E07.mkv')
    expect(r).toMatchObject({ type: 'tv', show: 'Breaking Bad', season: 3, episodes: [7] })
  })

  it('parses multi-episode file', () => {
    const r = parseFilename('/tv/Show/Season 01/Show - S01E01E02.mkv')
    expect(r).toMatchObject({ type: 'tv', season: 1, episodes: [1, 2] })
  })

  it('parses show with year', () => {
    const r = parseFilename('/tv/The Office (2005)/Season 01/The Office (2005) - S01E01 - Pilot.mkv')
    expect(r).toMatchObject({ type: 'tv', show: 'The Office', year: 2005, season: 1, episodes: [1] })
  })

  it('handles uppercase S and E', () => {
    const r = parseFilename('/tv/Show/S02E05.mkv')
    expect(r).toMatchObject({ type: 'tv', season: 2, episodes: [5] })
  })

  it('parses 01x01 convention', () => {
    const r = parseFilename('/tv/Breaking Bad/Season 01/Breaking Bad - 01x01 - Pilot.mkv')
    expect(r).toMatchObject({ type: 'tv', show: 'Breaking Bad', season: 1, episodes: [1], episodeTitle: 'Pilot' })
  })

  it('parses single-digit season in NxNN format', () => {
    const r = parseFilename('/tv/Show/1x05 - Episode Title.mkv')
    expect(r).toMatchObject({ type: 'tv', season: 1, episodes: [5] })
  })

  it('parses 2x03 with show name before', () => {
    const r = parseFilename('/tv/The Wire/The Wire - 2x03 - Hot Shots.mkv')
    expect(r).toMatchObject({ type: 'tv', show: 'The Wire', season: 2, episodes: [3], episodeTitle: 'Hot Shots' })
  })
})

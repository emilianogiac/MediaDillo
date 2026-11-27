import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectStaleFiles } from './stale-detector.js'
import * as walker from './walker.js'

vi.mock('./walker.js')

const mockList = (files: string[]) => {
  vi.mocked(walker.listFolderFiles).mockResolvedValue(files)
}

describe('detectStaleFiles', () => {
  const folder = '/mnt/nas/film/Movie (2020)'

  beforeEach(() => vi.clearAllMocks())

  it('returns empty when only known files present', async () => {
    mockList([
      `${folder}/Movie (2020).mkv`,
      `${folder}/poster.jpg`,
      `${folder}/backdrop.jpg`,
      `${folder}/movie.nfo`,
    ])
    const knownVideos = new Set([`${folder}/Movie (2020).mkv`])
    const stale = await detectStaleFiles(folder, knownVideos)
    expect(stale).toHaveLength(0)
  })

  it('flags .tbn file as stale', async () => {
    mockList([`${folder}/Movie (2020).mkv`, `${folder}/movie.tbn`])
    const knownVideos = new Set([`${folder}/Movie (2020).mkv`])
    const stale = await detectStaleFiles(folder, knownVideos)
    expect(stale).toHaveLength(1)
    expect(stale[0]?.path).toContain('movie.tbn')
  })

  it('flags .xml metadata file as stale', async () => {
    mockList([`${folder}/Movie.xml`])
    const stale = await detectStaleFiles(folder, new Set())
    expect(stale.some((s) => s.path.endsWith('.xml'))).toBe(true)
  })

  it('does not flag subtitle files', async () => {
    mockList([`${folder}/Movie (2020).srt`, `${folder}/Movie (2020).mkv`])
    const knownVideos = new Set([`${folder}/Movie (2020).mkv`])
    const stale = await detectStaleFiles(folder, knownVideos)
    expect(stale).toHaveLength(0)
  })

  it('flags orphaned video file not in library', async () => {
    mockList([`${folder}/Movie.old.avi`])
    const stale = await detectStaleFiles(folder, new Set())
    expect(stale[0]?.reason).toContain('not in library')
  })
})

describe('detectStaleFiles — subtitle formats (issue #71)', () => {
  const folder = '/mnt/nas/film/Movie (2020)'
  const video = `${folder}/Movie (2020).mkv`

  beforeEach(() => vi.clearAllMocks())

  it('never flags a subtitle sidecar as stale, in any format', async () => {
    // A format missing from SUBTITLE_EXTENSIONS falls through every branch to
    // "unrecognized file", so MediaDillo would offer to delete a real subtitle.
    // .sup is the one that bit us: four PGS tracks had to be rescued by hand.
    const exts = ['.srt', '.sub', '.idx', '.sup', '.ass', '.ssa', '.vtt', '.mks']
    mockList([video, ...exts.map((e) => `${folder}/Movie (2020).eng${e}`)])
    const stale = await detectStaleFiles(folder, new Set([video]))
    expect(stale.map((s) => s.path)).toEqual([])
  })

  it('flags a genuinely unrecognised file even alongside subtitles', async () => {
    // Guard against the fix being over-broad: widening the subtitle set must not
    // make the detector blind.
    mockList([video, `${folder}/Movie (2020).eng.sup`, `${folder}/mystery.bin`])
    const stale = await detectStaleFiles(folder, new Set([video]))
    expect(stale).toHaveLength(1)
    expect(stale[0]?.path).toContain('mystery.bin')
  })
})

describe('detectStaleFiles — artwork recognition (issue #92)', () => {
  const folder = '/mnt/nas/serie_tv/Show (2001)/Season 01'
  const video = `${folder}/Show - S01E01 - Pilot.mkv`

  beforeEach(() => vi.clearAllMocks())

  it('never flags an episode thumbnail, in either convention', () => {
    // Kodi/TMM write "<basename>.jpg", Jellyfin "<basename>-thumb.jpg". Neither can be
    // identified in isolation, so both looked like junk: 9,611 of them were queued for
    // deletion on the Milan library.
    mockList([
      video,
      `${folder}/Show - S01E01 - Pilot.jpg`,
      `${folder}/Show - S01E01 - Pilot-thumb.jpg`,
    ])
    const stale = await_detect(folder, new Set([video]))
    return stale.then((s) => expect(s.map((x) => x.path)).toEqual([]))
  })

  it('never flags season artwork', () => {
    mockList([
      video,
      `${folder}/season01.jpg`,
      `${folder}/season01-poster.jpg`,
      `${folder}/season01-banner.jpg`,
      `${folder}/season-specials-thumb.jpg`,
      `${folder}/season-all-fanart.jpg`,
      `${folder}/folder.jpg`,
    ])
    return await_detect(folder, new Set([video])).then((s) =>
      expect(s.map((x) => x.path)).toEqual([]),
    )
  })

  it('never flags the bare artwork names a TMM library carries', () => {
    mockList([
      video,
      `${folder}/landscape.jpg`,
      `${folder}/clearlogo.png`,
      `${folder}/characterart.png`,
      `${folder}/keyart.jpg`,
      `${folder}/fanart1.jpg`,
      `${folder}/fanart5.jpg`,
    ])
    return await_detect(folder, new Set([video])).then((s) =>
      expect(s.map((x) => x.path)).toEqual([]),
    )
  })

  it('still flags an image unrelated to any video in the folder', () => {
    // The fix must not blind the detector: a stray image with no matching video is junk.
    mockList([video, `${folder}/random-screenshot.jpg`])
    return await_detect(folder, new Set([video])).then((s) => {
      expect(s).toHaveLength(1)
      expect(s[0]?.path).toContain('random-screenshot.jpg')
    })
  })

  it('still flags genuinely stale types', () => {
    mockList([video, `${folder}/old.tbn`, `${folder}/notes.txt`])
    return await_detect(folder, new Set([video])).then((s) =>
      expect(s.map((x) => x.path.split('/').pop()).sort()).toEqual(['notes.txt', 'old.tbn']),
    )
  })
})

function await_detect(folder: string, known: Set<string>) {
  return detectStaleFiles(folder, known)
}

describe('detectStaleFiles — remaining false positives (issue #94)', () => {
  const season = '/mnt/nas/serie_tv/Show (2001)/Season 01'
  const movie = '/mnt/nas/film/Movie (2020)'

  beforeEach(() => vi.clearAllMocks())

  it('keeps an .nfo named after a video in the same folder', async () => {
    // Kodi and Jellyfin name an episode's NFO after its video, not `episode.nfo`.
    // 19 legitimate episode NFOs were queued for deletion on the Milan library.
    const video = `${season}/Show - S01E01 - Pilot.mkv`
    mockList([video, `${season}/Show - S01E01 - Pilot.nfo`, `${season}/tvshow.nfo`])
    const stale = await detectStaleFiles(season, new Set([video]))
    expect(stale.map((s) => s.path)).toEqual([])
  })

  it('keeps an episode NFO even when the video itself is not in the library', async () => {
    // The pairing is read off the filesystem, so an unmatched video (#97) does not
    // drag its NFO down with it — the video alone is reported.
    mockList([`${season}/00x03.mkv`, `${season}/00x03.nfo`, `${season}/tvshow.nfo`])
    const stale = await detectStaleFiles(season, new Set())
    expect(stale.map((s) => s.path)).toEqual([`${season}/00x03.mkv`])
  })

  it('keeps season.nfo', async () => {
    const video = `${season}/Show - S01E01 - Pilot.mkv`
    mockList([video, `${season}/season.nfo`])
    const stale = await detectStaleFiles(season, new Set([video]))
    expect(stale.map((s) => s.path)).toEqual([])
  })

  it('does not let season.nfo condemn a foreign NFO on its own', async () => {
    // season.nfo is not written by MediaDillo, so its presence is no evidence that
    // MediaDillo has taken the folder over.
    const video = `${season}/Show - S01E01 - Pilot.mkv`
    mockList([video, `${season}/season.nfo`, `${season}/Old TMM Export.nfo`])
    const stale = await detectStaleFiles(season, new Set([video]))
    expect(stale.map((s) => s.path)).toEqual([])
  })

  it('still flags a foreign NFO once a MediaDillo NFO is present', async () => {
    const video = `${movie}/Movie (2020).mkv`
    mockList([video, `${movie}/movie.nfo`, `${movie}/Old TMM Export.nfo`])
    const stale = await detectStaleFiles(movie, new Set([video]))
    expect(stale.map((s) => s.path)).toEqual([`${movie}/Old TMM Export.nfo`])
    expect(stale[0]?.reason).toContain('non-canonical NFO')
  })

  it('keeps logo.svg', async () => {
    const video = `${movie}/Movie (2020).mkv`
    mockList([video, `${movie}/logo.svg`])
    const stale = await detectStaleFiles(movie, new Set([video]))
    expect(stale.map((s) => s.path)).toEqual([])
  })

  it('treats logo.svg as the canonical counterpart of a suffixed logo', async () => {
    const video = `${movie}/Movie (2020).mkv`
    mockList([video, `${movie}/logo.svg`, `${movie}/Movie (2020)-logo.png`])
    const stale = await detectStaleFiles(movie, new Set([video]))
    expect(stale.map((s) => s.path)).toEqual([`${movie}/Movie (2020)-logo.png`])
  })

  it('keeps suffixed landscape art when it is the only landscape in the folder', async () => {
    // A backdrop does not supersede a landscape: they are different images. For nine
    // films the suffixed file was the only landscape artwork present.
    const video = `${movie}/Movie (2020).mkv`
    mockList([video, `${movie}/backdrop.jpg`, `${movie}/Movie (2020)-landscape.jpg`])
    const stale = await detectStaleFiles(movie, new Set([video]))
    expect(stale.map((s) => s.path)).toEqual([])
  })

  it('still flags suffixed landscape art once landscape.jpg exists', async () => {
    const video = `${movie}/Movie (2020).mkv`
    mockList([video, `${movie}/landscape.jpg`, `${movie}/Movie (2020)-landscape.jpg`])
    const stale = await detectStaleFiles(movie, new Set([video]))
    expect(stale.map((s) => s.path)).toEqual([`${movie}/Movie (2020)-landscape.jpg`])
    expect(stale[0]?.reason).toContain('superseded by canonical')
  })

  it('still flags the genuinely stale cases the triage confirmed', async () => {
    // TMM -poster/-backdrop with the canonical present, and a <title>.nfo duplicate
    // alongside movie.nfo: 26 of the 84 were real and must stay flagged.
    const video = `${movie}/Movie (2020).mkv`
    mockList([
      video,
      `${movie}/poster.jpg`,
      `${movie}/backdrop.jpg`,
      `${movie}/movie.nfo`,
      `${movie}/Movie (2020)-poster.jpg`,
      `${movie}/Movie (2020)-backdrop.jpg`,
      `${movie}/Movie (2020).nfo`,
    ])
    const stale = await detectStaleFiles(movie, new Set([video]))
    expect(stale.map((s) => s.path.split('/').pop()).sort()).toEqual([
      'Movie (2020)-backdrop.jpg',
      'Movie (2020)-poster.jpg',
      'Movie (2020).nfo',
    ])
  })
  it('flags a video-named NFO only when a per-item MediaDillo NFO supersedes it', async () => {
    // movie.nfo and episode.nfo describe the video beside them, so a video-named copy
    // is a duplicate. tvshow.nfo describes the show, not the episode next to it.
    const video = `${season}/Show - S01E01 - Pilot.mkv`
    const nfo = `${season}/Show - S01E01 - Pilot.nfo`

    mockList([video, nfo, `${season}/episode.nfo`])
    expect((await detectStaleFiles(season, new Set([video]))).map((s) => s.path)).toEqual([nfo])

    vi.clearAllMocks()
    mockList([video, nfo, `${season}/tvshow.nfo`])
    expect((await detectStaleFiles(season, new Set([video]))).map((s) => s.path)).toEqual([])
  })
})

describe('detectStaleFiles — a real multi-edition movie folder (issue #94)', () => {
  // Taken verbatim from /mnt/nas/film/Iron Man (2008) on the live library. It carries
  // every shape issue #94 is about at once: two videos, each with its own video-named
  // NFO and its own suffixed landscape art, movie.nfo present, and no landscape.jpg.
  const folder = '/mnt/nas/film/Iron Man (2008)'
  const names = [
    'Iron Man (2008) {edition-Extended Edition}-landscape.jpg',
    'Iron Man (2008) {edition-Extended Edition}.mkv',
    'Iron Man (2008) {edition-Extended Edition}.nfo',
    'Iron Man (2008)-landscape.jpg',
    'Iron Man (2008).mkv',
    'Iron Man (2008).nfo',
    'backdrop.jpg',
    'folder.jpg',
    'logo.png',
    'movie.nfo',
    'poster.jpg',
  ]

  beforeEach(() => vi.clearAllMocks())

  it('keeps both landscapes and flags only the two NFOs movie.nfo supersedes', async () => {
    mockList(names.map((n) => `${folder}/${n}`))
    const known = new Set([
      `${folder}/Iron Man (2008).mkv`,
      `${folder}/Iron Man (2008) {edition-Extended Edition}.mkv`,
    ])
    const stale = await detectStaleFiles(folder, known)
    expect(stale.map((s) => s.path.split('/').pop()).sort()).toEqual([
      'Iron Man (2008) {edition-Extended Edition}.nfo',
      'Iron Man (2008).nfo',
    ])
  })
})

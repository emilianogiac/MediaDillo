import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import {
  isSidecarFile,
  retargetSidecarName,
  migrateSidecars,
  migrateEpisodeSidecars,
  removeIfEmpty,
  sidecarsOfBasename,
} from './sidecars.js'

beforeAll(async () => {
  await fs.mkdir(path.join(process.cwd(), 'tmp', 'sidecars-test'), { recursive: true })
})

describe('isSidecarFile — bare artwork filenames (issue #71)', () => {
  // These are the two that stranded 1,566 files across the Milan library: they carry
  // no "-logo" style suffix, so ARTWORK_SUFFIXES cannot match them, and .png/.jpg are
  // not sidecar extensions — so before the fix they failed all three checks.
  it('recognises the artwork that was being stranded', () => {
    expect(isSidecarFile('logo.png')).toBe(true)
    expect(isSidecarFile('landscape.jpg')).toBe(true)
  })

  it('recognises the rest of the bare Kodi/Jellyfin artwork set', () => {
    for (const name of [
      'poster.jpg',
      'backdrop.jpg',
      'fanart.jpg',
      'thumb.jpg',
      'folder.jpg',
      'clearlogo.png',
      'clearart.png',
      'banner.jpg',
      'disc.png',
      'discart.png',
      'keyart.jpg',
      'characterart.png',
      'logo.svg',
    ]) {
      expect(isSidecarFile(name), name).toBe(true)
    }
  })

  it('recognises both the .jpg and .png spelling of each artwork type', () => {
    for (const stem of ['poster', 'backdrop', 'fanart', 'thumb', 'folder', 'landscape', 'logo']) {
      expect(isSidecarFile(`${stem}.jpg`), `${stem}.jpg`).toBe(true)
      expect(isSidecarFile(`${stem}.png`), `${stem}.png`).toBe(true)
    }
  })

  it('is case-insensitive', () => {
    expect(isSidecarFile('Logo.PNG')).toBe(true)
    expect(isSidecarFile('LANDSCAPE.JPG')).toBe(true)
  })

  it('still recognises suffixed artwork', () => {
    expect(isSidecarFile('Some Movie (1999)-logo.png')).toBe(true)
    expect(isSidecarFile('Some Movie (1999)_landscape.jpg')).toBe(true)
    expect(isSidecarFile('Some Movie (1999)-thumb.jpg')).toBe(true)
  })

  it('does not treat an arbitrary image or video as a sidecar', () => {
    // A stray image is not a sidecar: claiming it would migrate junk into the new
    // folder instead of leaving it to be flagged stale.
    expect(isSidecarFile('screenshot.png')).toBe(false)
    expect(isSidecarFile('IMG_4821.jpg')).toBe(false)
    expect(isSidecarFile('Some Movie (1999).mkv')).toBe(false)
  })
})

describe('isSidecarFile — subtitle extensions (issue #71)', () => {
  it('recognises every subtitle format', () => {
    for (const ext of ['.srt', '.sub', '.idx', '.sup', '.ass', '.ssa', '.vtt', '.mks']) {
      expect(isSidecarFile(`Some Movie (1999)${ext}`), ext).toBe(true)
      expect(isSidecarFile(`Some Movie (1999).eng${ext}`), `eng${ext}`).toBe(true)
    }
  })

  it('recognises the PGS subtitles that had to be rescued by hand', () => {
    // Four .sup tracks were stranded during the Milan remap because .sup was absent
    // from KNOWN_EXTENSIONS.
    for (const lang of ['eng', 'fra', 'por', 'spa']) {
      const name = `Animali fantastici - I crimini di Grindelwald (2018).${lang}.sup`
      expect(isSidecarFile(name), name).toBe(true)
    }
  })
})

describe('retargetSidecarName', () => {
  const oldBase = 'Old Title (1999)'
  const newBase = 'New Title (1999)'

  it('re-prefixes a subtitle so it still pairs with the renamed video', () => {
    // Players pair subtitles by basename; keeping the old one silently drops the
    // subtitle from the film.
    expect(retargetSidecarName(`${oldBase}.eng.srt`, oldBase, newBase)).toBe(
      `${newBase}.eng.srt`
    )
    expect(retargetSidecarName(`${oldBase}.srt`, oldBase, newBase)).toBe(`${newBase}.srt`)
  })

  it('preserves everything after the basename, including artwork suffixes', () => {
    expect(retargetSidecarName(`${oldBase}-thumb.jpg`, oldBase, newBase)).toBe(
      `${newBase}-thumb.jpg`
    )
    expect(retargetSidecarName(`${oldBase}.forced.eng.sup`, oldBase, newBase)).toBe(
      `${newBase}.forced.eng.sup`
    )
  })

  it('leaves bare sidecars alone', () => {
    // poster.jpg / movie.nfo carry no basename, so there is nothing to retarget.
    expect(retargetSidecarName('poster.jpg', oldBase, newBase)).toBe('poster.jpg')
    expect(retargetSidecarName('movie.nfo', oldBase, newBase)).toBe('movie.nfo')
    expect(retargetSidecarName('logo.png', oldBase, newBase)).toBe('logo.png')
  })

  it('leaves a sidecar belonging to a different video alone', () => {
    // A multi-file folder holds sidecars for several videos; only the ones prefixed
    // with this video's basename belong to this rename.
    expect(retargetSidecarName('Another Film (2001).eng.srt', oldBase, newBase)).toBe(
      'Another Film (2001).eng.srt'
    )
  })

  it('is a no-op when the basename is unchanged or unknown', () => {
    expect(retargetSidecarName(`${oldBase}.srt`, oldBase, oldBase)).toBe(`${oldBase}.srt`)
    expect(retargetSidecarName(`${oldBase}.srt`, '', '')).toBe(`${oldBase}.srt`)
  })
})

describe('migrateSidecars — end-to-end on a real directory (issue #71)', () => {
  // Temp space stays inside the project (never /tmp) per the repo conventions.
  const tmpRoot = path.join(process.cwd(), 'tmp', 'sidecars-test')
  let caseDir: string
  let oldFolder: string
  let newFolder: string

  beforeEach(async () => {
    caseDir = await fs.mkdtemp(path.join(tmpRoot, path.sep))
    oldFolder = path.join(caseDir, 'Old Title (1999)')
    newFolder = path.join(caseDir, 'New Title (1999)')
    await fs.mkdir(oldFolder, { recursive: true })
    await fs.mkdir(newFolder, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(caseDir, { recursive: true, force: true })
  })

  const write = (dir: string, name: string, body = 'x') =>
    fs.writeFile(path.join(dir, name), body)

  const ls = async (dir: string) => (await fs.readdir(dir)).sort()

  it('migrates the artwork that used to be stranded, leaving the old folder empty', async () => {
    // This is the exact shape that orphaned 1,230 directories: the video and most
    // sidecars moved, while logo.png and landscape.jpg stayed behind and kept the
    // directory non-empty, so the caller's rmdir could never succeed.
    await write(oldFolder, 'logo.png')
    await write(oldFolder, 'landscape.jpg')
    await write(oldFolder, 'poster.jpg')
    await write(oldFolder, 'movie.nfo')

    await migrateSidecars(oldFolder, newFolder, 'Old Title (1999)', 'New Title (1999)')

    expect(await ls(oldFolder)).toEqual([])
    expect(await ls(newFolder)).toEqual(['landscape.jpg', 'logo.png', 'movie.nfo', 'poster.jpg'])
    // The old folder being empty is what lets the caller remove it.
    await expect(fs.rmdir(oldFolder)).resolves.toBeUndefined()
  })

  it('re-prefixes subtitles to the new basename so they still pair', async () => {
    await write(oldFolder, 'Old Title (1999).eng.srt', 'subs')
    await write(oldFolder, 'Old Title (1999).ita.sup', 'pgs')

    await migrateSidecars(oldFolder, newFolder, 'Old Title (1999)', 'New Title (1999)')

    expect(await ls(newFolder)).toEqual(['New Title (1999).eng.srt', 'New Title (1999).ita.sup'])
    expect(await fs.readFile(path.join(newFolder, 'New Title (1999).eng.srt'), 'utf8')).toBe('subs')
  })

  it('does not overwrite artwork already present in the destination', async () => {
    // The destination copy is current (the artwork writer ran there); the source is
    // left over from the old layout and must not clobber it.
    await write(oldFolder, 'poster.jpg', 'stale')
    await write(newFolder, 'poster.jpg', 'current')

    await migrateSidecars(oldFolder, newFolder, 'Old Title (1999)', 'New Title (1999)')

    expect(await fs.readFile(path.join(newFolder, 'poster.jpg'), 'utf8')).toBe('current')
    // The source is left in place rather than silently destroyed.
    expect(await ls(oldFolder)).toEqual(['poster.jpg'])
  })

  it('leaves non-sidecar files behind for the stale detector', async () => {
    await write(oldFolder, 'logo.png')
    await write(oldFolder, 'random-notes.txt')

    await migrateSidecars(oldFolder, newFolder, 'Old Title (1999)', 'New Title (1999)')

    expect(await ls(oldFolder)).toEqual(['random-notes.txt'])
    expect(await ls(newFolder)).toEqual(['logo.png'])
  })

  it('does not throw when the old folder is already gone', async () => {
    await fs.rm(oldFolder, { recursive: true, force: true })
    await expect(
      migrateSidecars(oldFolder, newFolder, 'Old Title (1999)', 'New Title (1999)')
    ).resolves.toBeUndefined()
  })
})

describe('migrateEpisodeSidecars (issue #82)', () => {
  const tmpRoot = path.join(process.cwd(), 'tmp', 'sidecars-test')
  let caseDir: string, oldDir: string, newDir: string
  const OLD = 'Suits_-_01x01_-_Avvocato_per_caso_h264_720p_DTS_2ch'
  const NEW = 'Suits - S01E01 - Avvocato per caso'

  beforeEach(async () => {
    caseDir = await fs.mkdtemp(path.join(tmpRoot, path.sep))
    oldDir = path.join(caseDir, 's01')
    newDir = path.join(caseDir, 'Season 01')
    await fs.mkdir(oldDir, { recursive: true })
    await fs.mkdir(newDir, { recursive: true })
  })
  afterEach(async () => { await fs.rm(caseDir, { recursive: true, force: true }) })

  const write = (d: string, n: string, b = 'x') => fs.writeFile(path.join(d, n), b)
  const ls = async (d: string) => (await fs.readdir(d)).sort()

  it('moves and re-targets this episode’s sidecars', async () => {
    await write(oldDir, `${OLD}.nfo`)
    await write(oldDir, `${OLD}-thumb.jpg`)
    await write(oldDir, `${OLD}.eng.srt`, 'subs')

    const n = await migrateEpisodeSidecars(oldDir, newDir, OLD, NEW)

    expect(n).toBe(3)
    expect(await ls(newDir)).toEqual([`${NEW}-thumb.jpg`, `${NEW}.eng.srt`, `${NEW}.nfo`])
    expect(await fs.readFile(path.join(newDir, `${NEW}.eng.srt`), 'utf8')).toBe('subs')
  })

  it('leaves other episodes in the season alone', async () => {
    // The season directory is shared, so only files named after THIS video may move.
    const OTHER = 'Suits_-_01x02_-_Codice_etico_h264_720p_DTS_2ch'
    await write(oldDir, `${OLD}.nfo`)
    await write(oldDir, `${OTHER}.nfo`)
    await write(oldDir, `${OTHER}.mkv`)

    await migrateEpisodeSidecars(oldDir, newDir, OLD, NEW)

    expect(await ls(newDir)).toEqual([`${NEW}.nfo`])
    expect(await ls(oldDir)).toEqual([`${OTHER}.mkv`, `${OTHER}.nfo`])
  })

  it('does not move non-sidecar files that merely share the prefix', async () => {
    await write(oldDir, `${OLD}.notes.txt`)
    const n = await migrateEpisodeSidecars(oldDir, newDir, OLD, NEW)
    expect(n).toBe(0)
    expect(await ls(oldDir)).toEqual([`${OLD}.notes.txt`])
  })

  it('never overwrites an existing destination', async () => {
    await write(oldDir, `${OLD}.nfo`, 'stale')
    await write(newDir, `${NEW}.nfo`, 'current')
    await migrateEpisodeSidecars(oldDir, newDir, OLD, NEW)
    expect(await fs.readFile(path.join(newDir, `${NEW}.nfo`), 'utf8')).toBe('current')
    expect(await ls(oldDir)).toEqual([`${OLD}.nfo`])
  })

  it('is a no-op with an empty basename or missing directory', async () => {
    expect(await migrateEpisodeSidecars(oldDir, newDir, '', NEW)).toBe(0)
    expect(await migrateEpisodeSidecars(path.join(caseDir, 'nope'), newDir, OLD, NEW)).toBe(0)
  })
})

describe('removeIfEmpty (issue #82)', () => {
  const tmpRoot = path.join(process.cwd(), 'tmp', 'sidecars-test')
  it('removes an empty directory and keeps a non-empty one', async () => {
    const d = await fs.mkdtemp(path.join(tmpRoot, path.sep))
    const empty = path.join(d, 'empty')
    const full = path.join(d, 'full')
    await fs.mkdir(empty); await fs.mkdir(full)
    await fs.writeFile(path.join(full, 'x.mkv'), 'x')

    expect(await removeIfEmpty(empty)).toBe(true)
    expect(await removeIfEmpty(full)).toBe(false)
    await fs.rm(d, { recursive: true, force: true })
  })
})

describe('migrateEpisodeSidecars — bare episode thumbnails (issue #86)', () => {
  const tmpRoot = path.join(process.cwd(), 'tmp', 'sidecars-test')
  const OLD = 'A-Team_-_01x06_-_Giornata_infernale_h265_480p_AC3_2ch'
  const NEW = 'A-Team - S01E05 - Giornata infernale a Bad Rock'
  let caseDir: string, dir: string

  beforeEach(async () => {
    caseDir = await fs.mkdtemp(path.join(tmpRoot, path.sep))
    dir = path.join(caseDir, 's01')
    await fs.mkdir(dir, { recursive: true })
  })
  afterEach(async () => { await fs.rm(caseDir, { recursive: true, force: true }) })

  it('moves a bare <basename>.jpg thumbnail', async () => {
    // Kodi/TMM write the episode thumb as "<episode basename>.jpg" with no -thumb
    // suffix, so isSidecarFile cannot recognise it on its own. The prefix match does.
    await fs.writeFile(path.join(dir, `${OLD}.jpg`), 'x')
    await fs.writeFile(path.join(dir, `${OLD}.srt`), 'x')
    const n = await migrateEpisodeSidecars(dir, dir, OLD, NEW)
    expect(n).toBe(2)
    expect((await fs.readdir(dir)).sort()).toEqual([`${NEW}.jpg`, `${NEW}.srt`])
  })

  it('still refuses an unrelated image that does not share the basename', async () => {
    // Show-level artwork must survive: it does not carry the episode basename.
    await fs.writeFile(path.join(dir, 'poster.jpg'), 'x')
    await fs.writeFile(path.join(dir, 'banner.jpg'), 'x')
    const n = await migrateEpisodeSidecars(dir, dir, OLD, NEW)
    expect(n).toBe(0)
    expect((await fs.readdir(dir)).sort()).toEqual(['banner.jpg', 'poster.jpg'])
  })
})

describe('sidecarsOfBasename (issue #79)', () => {
  const base = 'Il Gattopardo (1963) - part1'

  it('claims the sidecars named after the part', () => {
    expect(
      sidecarsOfBasename(
        [
          `${base}.nfo`,
          `${base}.eng.srt`,
          `${base}-thumb.jpg`,
          `${base}.jpg`,
          `${base}-poster.png`,
        ],
        base,
      ).sort(),
    ).toEqual(
      [`${base}-poster.png`, `${base}-thumb.jpg`, `${base}.eng.srt`, `${base}.jpg`, `${base}.nfo`].sort(),
    )
  })

  it('leaves the folder-level artwork and NFO alone', () => {
    // The merged file lands in this same folder and keeps using these.
    expect(
      sidecarsOfBasename(
        ['poster.jpg', 'backdrop.jpg', 'movie.nfo', 'logo.svg', 'Il Gattopardo (1963).nfo'],
        base,
      ),
    ).toEqual([])
  })

  it('does not claim the part video itself, or the other part', () => {
    expect(
      sidecarsOfBasename([`${base}.mkv`, 'Il Gattopardo (1963) - part2.mkv'], base),
    ).toEqual([])
  })

  it('requires a separator, so part1 cannot claim part10', () => {
    // The returned list goes to deleteToTrash, so a loose prefix match destroys files.
    expect(sidecarsOfBasename(['Movie - part10.srt', 'Movie - part1.srt'], 'Movie - part1')).toEqual([
      'Movie - part1.srt',
    ])
  })

  it('ignores a file that merely starts with the basename but is not a sidecar', () => {
    expect(sidecarsOfBasename([`${base}.bin`, `${base}.db`], base)).toEqual([])
  })

  it('returns nothing for an empty basename rather than claiming the folder', () => {
    expect(sidecarsOfBasename(['poster.jpg', 'movie.nfo'], '')).toEqual([])
  })
})

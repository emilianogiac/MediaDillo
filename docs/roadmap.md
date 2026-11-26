# MediaDillo — Roadmap

Track epics and their GitHub issues here. Update status as work progresses.

## Status Legend
- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete

---

## Epics

| # | Epic | GitHub Issue | Status | Notes |
|---|------|-------------|--------|-------|
| 0 | **Docs** | [#1](https://github.com/emilianogiac/MediaDillo/issues/1) | `[x]` | `./docs/specs.md` + `./docs/roadmap.md` |
| 1 | **Foundation** | [#2](https://github.com/emilianogiac/MediaDillo/issues/2) | `[x]` | Docker Compose, DB schema, Fastify skeleton, React shell — PR #14 |
| 2 | **Scanner** | [#3](https://github.com/emilianogiac/MediaDillo/issues/3) | `[x]` | Multi-root NAS walk, ffprobe extraction, scan logs — PR #15 |
| 3 | **Metadata** | [#4](https://github.com/emilianogiac/MediaDillo/issues/4) | `[x]` | TMDB/TVDB integration, matching engine, completeness flags — PR #16 |
| 4 | **Artwork Manager** | [#5](https://github.com/emilianogiac/MediaDillo/issues/5) | `[x]` | Download missing art, TMDB image search, health badges — PR #17 |
| 5 | **Movie Library UI** | [#6](https://github.com/emilianogiac/MediaDillo/issues/6) | `[x]` | Grid by category, detail page with tech specs — PR #18 |
| 6 | **TV Library UI** | [#7](https://github.com/emilianogiac/MediaDillo/issues/7) | `[x]` | Show/season/episode views, tech specs — PR #19 |
| 7 | **Missing Tracker** | [#8](https://github.com/emilianogiac/MediaDillo/issues/8) | `[x]` | Episode diff engine, missing content views, movie wishlist — PR #20 |
| 8 | **File Manager** | [#9](https://github.com/emilianogiac/MediaDillo/issues/9) | `[x]` | Rename engine, preview diffs, move ops, stale cleanup — PR #21 |
| 9 | **Health View** | [#10](https://github.com/emilianogiac/MediaDillo/issues/10) | `[x]` | `/health` page, bulk artwork download, bulk metadata refresh — PR #22 |
| 10 | **Jellyfin Sync** | [#11](https://github.com/emilianogiac/MediaDillo/issues/11) | `[x]` | Post-op library refresh trigger, watched status — PR #23 |
| 11 | **Export & NFO** | [#12](https://github.com/emilianogiac/MediaDillo/issues/12) | `[x]` | JSON/CSV export, NFO sidecar writer — PR #24 |
| 12 | **Polish** | [#13](https://github.com/emilianogiac/MediaDillo/issues/13) | `[x]` | Dashboard stats, scan scheduling, settings UI — PR #25 |

---

## Post-Launch Feature Batch (2026-05-06)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| F1 | **External links** | `[x]` | TMDB / IMDb / TVDB pill links on movie + show detail pages |
| F2 | **Italian metadata** | `[x]` | `METADATA_LANGUAGE=it-IT` env var; title + overview fetched in Italian with English fallback |
| F2b | **IMDb → TMDB auto-match** | `[x]` | `findByImdbId()` in TMDB client; used in scan + prepended as first MatchModal candidate |
| F3 | **Sidecar migration on rename** | `[x]` | Poster/backdrop/NFO/subtitles/TMM artwork files migrate with movie folder; show-folder rename updates all EpisodeFile paths in DB |
| F4 | **Multi-part file merger** | `[x]` | ffmpeg concat for -cd1/-cd2/-part1/-part2 pairs; "Multi-part" tab in File Manager |
| F5 | **Episode remapper** | `[x]` | `multiEpisodeEnd` on EpisodeFile; S01E01E02 naming; "Episode Remap" tab in File Manager |

---

## Post-Launch Fix & Polish Batch (2026-05-06)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| G1 | **Duplicate badge + filter** | `[x]` | Orange "Duplicate" badge on poster cards; tri-state filter (all / only / hide) on /movies and /shows; `@unique` removed from `Movie.tmdbId` and `TvShow.tmdbId` |
| G2 | **DB maintenance tools** | `[x]` | Settings: "Verify library integrity" (removes ghost records + missing files) + "Merge duplicate TV shows" (consolidates phantom TvShow records) |
| G3 | **Scanner orphan pruning** | `[x]` | `pruneOrphanedFiles()` runs after every scan; removes DB records for paths no longer on disk |
| G4 | **Forced artwork re-download** | `[x]` | Manual artwork download routes pass `force=true` to bypass `posterDownloaded` guard |
| G5 | **Show Cleanup & Organize panel** | `[x]` | Collapsible panel on show detail: rename queue (preview + per-item select + apply) + stale file removal |
| G6 | **Season rescan** | `[x]` | "Rescan" button on season detail page; scoped single-folder scan with orphan pruning; synchronous with inline result |
| G7 | **Multi-part episode merge + renumber** | `[x]` | MergePartsPanel on season detail: rename E05+E06 → E05-part1/part2, re-parent files in DB, cascade renumber E07+ down by 1 |
| G8 | **Missing file badge + filter + delete** | `[x]` | Red "Missing file" badge on poster cards; filter button on /movies; "Delete this record" button on movie detail when no files attached |
| G9 | **Consistent filter buttons** | `[x]` | All /movies filters converted from mixed checkboxes+buttons to uniform toggle buttons with colour-coded active states |
| G10 | **Back navigation preserves filters** | `[x]` | `navigate(-1)` replaces hardcoded `<Link to="/movies\|/shows">` on detail pages and post-delete redirect |
| G11 | **Parser: disc suffix + bare year** | `[x]` | `cd1`/`cd2`/`disc1` stripped before movie year extraction; bare trailing year stripped from TV show name portion so episodes with/without year in filename map to same TvShow |

---

## Fix Batch (2026-11-25)

| # | Fix | Status | Notes |
|---|-----|--------|-------|
| H1 | **4-digit year seasons** | `[x]` | Parser capped seasons at 2 digits and was unanchored, so `2003x05` matched the substring `03x05` → season 3. TheTVDB numbers several shorts/anthology series by year; 94 episode files across I corti Pixar (1984–2015), Looney Tunes (1949–1994) and Tom & Jerry (1960) were mis-filed, with `2000x01` collapsing into Season 0. Season widened to 4 digits in all three branches, `NxN` fenced with digit boundaries, plus a year+episode-cap plausibility check so `WxH` resolution tokens cannot parse as episode codes (latent bug: `1920x1080` → S20E108). Issue #67, PR #68 |
| H2 | **Non-ASCII symbols leak into filenames** | `[x]` | `sanitizeForFilename` was documented as ASCII-safe but only handled an enumerated list of typographic characters; `NFD` + `\p{Mn}` stripping only removes combining marks, so a standalone symbol passed straight through. MediaDillo renamed `WALL-E (2008)` → `WALL•E (2008)` on the Milan library, writing U+2022 into a path synced to the UNAS; a DB sweep found `°` affected too (`Il 13° guerriero`). Added the bullet/middot family and `°` to the map, plus a catch-all dropping any remaining non-ASCII `\p{S}`/`\p{P}`. Non-Latin letters preserved on purpose — stripping them would empty the filename. Issue #69 |
| H3 | **Sidecars stranded on rename** | `[x]` | `isSidecarFile` had three recognition paths and a bare `logo.png` failed all three: absent from `KNOWN_FILENAMES`, `.png` absent from `KNOWN_EXTENSIONS`, and `ARTWORK_SUFFIXES` matches a *suffix* so `base="logo"` never ends with `-logo`. The existing `rmdir` of the old folder therefore always failed, orphaning 1,230 dirs / 1,566 files / 748 MiB on Milan. Added the bare Kodi/Jellyfin artwork names and `.idx/.sup/.vtt/.mks`; sidecars prefixed with the old video basename are re-prefixed so subtitles still pair; destination files are no longer silently overwritten. Also fixed two related bugs found while reading: `detectStaleFilesForMovie` ignored `ARTWORK_SUFFIXES` (so `<title>-logo.png` was migrated then flagged stale), and `detectStaleFiles` had a hardcoded subtitle list missing `.sup`/`.mks`, flagging PGS subtitles as `unrecognized file`. Pure logic extracted to `files/sidecars.ts`. Issue #71 |
| H4 | **StaleFile rows append-only** | `[x]` | Every scan inserted a fresh row per stale path and nothing ever set `resolved`, so the table grew without bound: 40,412 rows over 23,392 distinct paths (42% duplicates), 0 ever resolved across 8 scans, and 11,338 paths (48%) pointing at files that no longer exist. Worse, rows for files that stopped being stale persisted — the four live Grindelwald `.sup` subtitles rescued by hand were still flagged `unrecognized file` after H3, so a bulk-delete would have deleted them again. `writeScanLog` now reconciles against the freshly computed set, scoped to the roots actually walked: a path no longer stale is resolved, a still-stale path keeps its existing row, only new paths are inserted. No schema change — `resolved` already existed and `ScanLog` is never pruned. Issue #73 |
| H5 | **Match permanently deleted subtitles** | `[x]` | `POST /metadata/movies/:id/match` ends in an unattended cleanup gated on `match.autoCleanupFolder` (true on Milan). `BATCH_SAFE_TO_DELETE` contained `subtitle` and `unknown`, and `scanMovieFolder` assigned `subtitle` to any file with a subtitle extension and `unknown` to any video not yet in the DB — then `fs.unlink`ed them. So matching a movie permanently destroyed its subtitles, and a video copied in before the next scan. All 5 subtitles in the Milan movie library were exposed, including the PGS tracks and the `.srt` rescued by hand in H3. The web cleanup panel pre-ticked the same categories. Split `unknown-video` out of `unknown`, dropped `subtitle` and `unknown-video` from the auto set, switched to `deleteToTrash`, aligned the UI. Pure rules extracted to `files/cleanup-categories.ts`. Issue #75 |
| H6 | **Part merge had no safety gate** | `[x]` | `mergeMovieParts` concatenated any two files whose names matched `part1`/`part2`, then trashed both originals and repointed the DB — with no check that they were halves of one film and no check that the output was valid. Probing the Milan candidates found three failure classes: `Sahara (2005)` was a 4K and a 1080p copy both running 123.9 min (merging would have produced the film twice); seven pairs had a 19–130 s sample or trailer as a 'part'; and several had mismatched containers, audio codecs or track counts. Added a probe-based gate classifying each pair as parts/versions/junk/unknown plus stream compatibility, and output verification against the summed duration before the originals are retired. Duration comes from the last video packet, not the container header (Ronin's header claimed 176.8 min for 56.9 min of video), and the runtime check only guards against shortfall since TMDB stores theatrical runtimes while the LOTR pairs are extended editions. Issue #77 |

---

## Working Agreement
- Autonomous mode: minimal approval interruptions
- Every code change backed by a GitHub issue
- Branch naming: `issue-{N}-{slug}`
- Conventional commits with `Closes #N` footer
- Never commit directly to main
- Update this file when epic status changes

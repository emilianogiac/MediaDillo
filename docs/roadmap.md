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

## Working Agreement
- Autonomous mode: minimal approval interruptions
- Every code change backed by a GitHub issue
- Branch naming: `issue-{N}-{slug}`
- Conventional commits with `Closes #N` footer
- Never commit directly to main
- Update this file when epic status changes

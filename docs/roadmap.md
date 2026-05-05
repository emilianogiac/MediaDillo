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
| 1 | **Foundation** | [#2](https://github.com/emilianogiac/MediaDillo/issues/2) | `[~]` | PR #14 open — pending merge |
| 2 | **Scanner** | [#3](https://github.com/emilianogiac/MediaDillo/issues/3) | `[ ]` | Multi-root NAS walk, ffprobe extraction, scan logs |
| 3 | **Metadata** | [#4](https://github.com/emilianogiac/MediaDillo/issues/4) | `[ ]` | TMDB/TVDB integration, matching engine, completeness flags |
| 4 | **Artwork Manager** | [#5](https://github.com/emilianogiac/MediaDillo/issues/5) | `[ ]` | Download missing art, TMDB image search, health badges |
| 5 | **Movie Library UI** | [#6](https://github.com/emilianogiac/MediaDillo/issues/6) | `[ ]` | Grid by category, detail page with tech specs |
| 6 | **TV Library UI** | [#7](https://github.com/emilianogiac/MediaDillo/issues/7) | `[ ]` | Show/season/episode views, tech specs |
| 7 | **Missing Tracker** | [#8](https://github.com/emilianogiac/MediaDillo/issues/8) | `[ ]` | Episode diff engine, missing content views, movie wishlist |
| 8 | **File Manager** | [#9](https://github.com/emilianogiac/MediaDillo/issues/9) | `[ ]` | Rename engine, preview diffs, move ops, stale cleanup |
| 9 | **Health View** | [#10](https://github.com/emilianogiac/MediaDillo/issues/10) | `[ ]` | `/health` page, bulk artwork download, bulk metadata refresh |
| 10 | **Jellyfin Sync** | [#11](https://github.com/emilianogiac/MediaDillo/issues/11) | `[ ]` | Post-op library refresh trigger |
| 11 | **Export & NFO** | [#12](https://github.com/emilianogiac/MediaDillo/issues/12) | `[ ]` | JSON/CSV export, NFO sidecar writer |
| 12 | **Polish** | [#13](https://github.com/emilianogiac/MediaDillo/issues/13) | `[ ]` | Dashboard stats, scan scheduling, settings UI |

---

## Working Agreement
- Autonomous mode: minimal approval interruptions
- Every code change backed by a GitHub issue
- Branch naming: `issue-{N}-{slug}`
- Conventional commits with `Closes #N` footer
- Never commit directly to main
- Update this file when epic status changes

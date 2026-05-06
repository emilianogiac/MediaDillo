---
name: Scanner routing pattern
description: ScanRoot.type ('movies'|'tv') is authoritative for routing files to syncMovieFile vs syncEpisodeFile; the filename parser is a hint only
type: project
---

The filename parser (`filename-parser.ts`) uses `TV_SE_RE` to detect S/E patterns. Files without that pattern are classified as `type: 'movie'`. This is intentional — the parser cannot know the library context.

The scanner (`index.ts`) must use `rootConfig.type` as the primary routing key, not `parsed.type`. A TV scan root should always go to `syncEpisodeFile`; if the parser couldn't find an S/E pattern, skip the file with a warning rather than polluting the Movie table.

**Why:** Bug found 2026-05-05 — TV episodes without S/E patterns (specials, featurettes, bare pilot files) were landing in the Movie table and appearing on the /movies page.

**How to apply:** Any time the scanner routing logic is touched, verify `rootConfig.type` is the outer branch and `parsed.type` is only used as a validation/skip guard inside each branch.

# Bug Case: POST /api/metadata/shows/:id/enrich returns 500 "Enrichment failed"
Date: 2026-05-10
Status: Solved

## Symptoms
User hits "Re-match" or triggers enrichment on a TVDB-only show (e.g. "L'uomo tigre", `tmdbId=null`, `tvdbId` set). The `POST /api/metadata/shows/{id}/enrich` route returns HTTP 500 with body `{ "error": "Enrichment failed" }`.

## Root Cause
Two compounding bugs in the TVDB episode ingestion pipeline:

**Bug 1 — Null episode numbers from TVDB (primary crash)**
The TVDB API returns `number: null` for placeholder/future episodes that haven't been assigned an episode number yet. The `TvdbEpisode` interface incorrectly typed `number` and `seasonNumber` as `number` (non-nullable). When these null values reached `prisma.episode.create({ data: { episodeNumber: null } })`, Prisma threw a validation error because `Episode.episodeNumber` is a non-nullable `Int` column. This uncaught exception propagated through `enrichShowFromTvdb` → route handler → HTTP 500.

**Bug 2 — Duplicate episode numbers in absolute ordering (secondary crash)**
TVDB sometimes returns duplicate episode number entries in absolute ordering for specials/OVAs. A second insert with the same `(seasonId, episodeNumber)` pair would violate the `@@unique([seasonId, episodeNumber])` constraint → another uncaught Prisma error → HTTP 500.

## Investigation Notes
- Most recent commit `26b0b24` added `enrichShowFromTvdb` fallback from `official` → `absolute` ordering. The `absolute` ordering is more prone to null episode numbers and duplicates, making this bug newly surface.
- `syncAllSeasonsFromTvdb` was the crash site for the TVDB-only path (absolute ordering, all episodes fetched at once).
- `syncSeasonFromTvdb` was exposed to the same null-number risk on the per-season TMDB+TVDB path.
- TypeScript didn't catch this because `getEpisodes` casts the JSON response directly to `TvdbEpisode[]`, trusting the interface definition which was wrong.

## Solution
Three changes across two files:

**`apps/api/src/metadata/tvdb-client.ts`**
- Corrected `TvdbEpisode` interface: `number: number | null` and `seasonNumber: number | null` to match actual TVDB API behavior.

**`apps/api/src/metadata/enricher.ts`**
- `syncSeasonFromTvdb`: filter raw episode list with a type-guard before processing — `allEpisodes.filter((ep): ep is TvdbEpisode & { number: number } => ep.number != null)`. Fixes episodeCount accuracy too.
- `syncAllSeasonsFromTvdb`: same null-filter on the full episode list before grouping. Added within-season deduplication by episode number (keeps first occurrence) to prevent unique-constraint violations from TVDB duplicate entries.

## Prevention
- Never trust TVDB JSON field types without null guards — their API is inconsistent, especially for absolute ordering and unannounced future episodes.
- The `getEpisodes` method casts `as TvdbEpisode[]` which bypasses TS. Any future TVDB response fields added to the interface should be typed as nullable by default until confirmed otherwise.
- Consider adding a Zod schema at the TVDB client boundary to validate response shapes at runtime rather than relying on type assertions.

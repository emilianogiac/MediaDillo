# Bug Case: TV Episodes Appearing on Movies Page

Date: 2026-05-05
Status: Solved

## Symptoms

TV series episodes were visible on the `/movies` page in the MediaDillo web UI.

## Root Cause

`apps/api/src/scanner/index.ts` routed files to `syncMovieFile` or `syncEpisodeFile` based solely on what the filename parser returned (`parsed.type`). The filename parser only detects TV episodes via a strict `S01E01` / `S01E01E02` regex (`TV_SE_RE`). Any file under a TV scan root that lacks that pattern — specials, featurettes, Plex/Kodi-style `Show.504.mkv`, bare pilot files like `Breaking Bad - Pilot.mkv` — fell through to `parseMovieFilename` and was classified as `type: 'movie'`. The scanner then called `syncMovieFile` for those files, inserting spurious `Movie` rows linked to the TV scan root.

The `ScanRoot.type` field (`'movies'` | `'tv'`) existed in both the config schema and the database but was never consulted in the routing decision.

## Investigation Notes

- `movies.ts` route query is clean — it only queries `prisma.movie`, no cross-table leak.
- `db-sync.ts` `syncMovieFile` / `syncEpisodeFile` are clean — they validate `parsed.type` internally and would throw if called with the wrong type.
- `filename-parser.ts` regex `TV_SE_RE = /[Ss](\d{1,2})[Ee](\d{1,2})(?:[Ee](\d{1,2}))*/` — anything without S/E notation goes to `parseMovieFilename`. Correct by design; the scanner is supposed to use root type as the authoritative override.
- The bug was entirely in `scanner/index.ts` lines 64-69 where `parsed.type` drove the branch instead of `rootConfig.type`.

## Solution

Changed the routing logic in `apps/api/src/scanner/index.ts` to use `rootConfig.type` as the primary decision:

- `rootConfig.type === 'tv'`: always call `syncEpisodeFile`. If `parsed.type !== 'tv'` (no S/E pattern found), skip the file with a `console.warn` — it cannot be safely synced as either type.
- `rootConfig.type === 'movies'` (default): only call `syncMovieFile` when `parsed.type === 'movie'`. If somehow a TV-pattern file appears in a movies root, skip it with a warning rather than silently misrouting it.

Added `apps/api/src/scanner/index.test.ts` with 5 tests covering all routing branches including the misclassification skip path.

## Prevention

- Scan root `type` should always be the ground truth for routing. Never trust parser classification alone when the root type is available.
- The skip-with-warn approach for unrecognised TV files is deliberate: future work could improve the TV parser to handle non-S/E formats (e.g. `SXNN`, `504`, bare episode titles), but that should happen in the parser, not by silently creating wrong DB records.
- Consider adding a `skippedFiles` count to `ScanSummary` so the UI can surface unrecognised files to the user.

## Files Changed

- `apps/api/src/scanner/index.ts` — routing fix (lines 63-81)
- `apps/api/src/scanner/index.test.ts` — new test file (5 tests)

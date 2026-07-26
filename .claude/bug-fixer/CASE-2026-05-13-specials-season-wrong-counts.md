# Bug Case: Specials Season Wrong Episode Counts (multiple bugs, two rounds)
Date: 2026-05-13
Status: Solved (Round 2)

## Symptoms (Round 2 — current report)
Show "Sampei" after deleting Specials files and rescanning:
- Specials card still appears showing 0/109 (should disappear)
- Show-level counter reads 109/218 instead of 109/109

## Root Causes (Round 2)

### Bug A — ghost Season 0 cleanup gated on orphaned.length > 0
In all three scan entry points (`pruneOrphanedFiles`, `runShowScan`, `runSeasonScan`), the Season 0
ghost cleanup was inside an `if (orphaned.length > 0)` block. If EpisodeFiles were already deleted
in a prior scan pass but the Season 0 row survived, subsequent scans see zero orphaned files and
skip the entire cleanup block — leaving the ghost row permanently.

**Fix**: Extract ghost Season 0 cleanup to run unconditionally after the orphaned-file block in all
three functions. Use a direct `season.findFirst({ seasonNumber: 0 })` + `_count.owned === 0` check.

### Bug B — affectedShowIds derived from already-deleted episode rows
In `pruneOrphanedFiles`, after deleting ghost season episodes at line 646, the `affectedShowIds`
query used `affectedEpisodeIds` — but those Episode rows were just deleted. The query returned
empty, so `tvShow.update` never ran and counts were not recalculated even when Season 0 was
successfully deleted.

**Fix**: Collect showId from episode rows BEFORE deleting them, and accumulate into a Set that
is used at the end for the count-recalculation loop.

### Bug C — syncAllSeasonsFromTvdb writes episodeCount on existing Season 0
In `enricher.ts`, `syncAllSeasonsFromTvdb` had a guard `if (seasonNumber === 0) continue` for
the season-creation path. But when Season 0 already existed in DB, it fell through to the `else`
branch which unconditionally updated `episodeCount: uniqueEps.length`. TVDB may return Season 1
episodes under season 0 for shows with no real specials, corrupting the count (to 109 for Sampei).

**Fix**: Change `} else {` to `} else if (seasonNumber !== 0) {` with a comment. Same guard logic
as the creation path.

### Bug D — runSeasonScan returns early before cleanup when folder not found
When Season 0 EpisodeFiles are already pruned, `runSeasonScan(showId, 0)` has no DB record to
derive `seasonFolderPath` from, and `findSeasonFolder` can't find a folder named "Specials" (only
checks "Season 0", "S00" etc.). The function returns early with `folderFound: false` — never
running the ghost cleanup.

**Fix**: Add Season 0 ghost cleanup in the early-return path (`!seasonFolderPath && seasonNumber === 0`).

---

## Previous Round (2026-05-13 earlier)

### Bug 1 — totalEpisodes inflated by locally-scanned files
`totalEpisodes` was computed via `episode.count()` (all rows) rather than
`season.aggregate._sum.episodeCount`. Fixed in commit 119ddef.

### Bug 2 — syncSeasonFromTvdb ownedOnly path overwrites episodeCount
`syncSeasonFromTvdb` with `ownedOnly=true` unconditionally wrote `episodeCount: episodes.length`.
Fixed in commit 119ddef by guarding with `!ownedOnly`.

### Bug 3 — totalEpisodes not recalculated after ghost season deletion
After pruning, only `ownedEpisodes` was updated. Fixed in commit 119ddef by adding
`season.aggregate._sum.episodeCount` recalculation in all scan functions.

---

## Files Changed (Round 2)
- `apps/api/src/metadata/enricher.ts` — guard `syncAllSeasonsFromTvdb` else branch with `seasonNumber !== 0`
- `apps/api/src/scanner/db-sync.ts` — unconditional ghost Season 0 cleanup; fix affectedShowIds ordering
- `apps/api/src/scanner/index.ts` — unconditional ghost Season 0 cleanup in both runShowScan and runSeasonScan; early-return Season 0 cleanup in runSeasonScan

## Prevention
- Any ghost-season cleanup must run outside any `if (orphaned.length > 0)` gate — ghost rows
  can outlive the EpisodeFiles that caused them.
- `affectedShowIds` must be collected BEFORE deleting episode rows — not after.
- `syncAllSeasonsFromTvdb` Season 0 guard must cover BOTH the create and update branches.
- Season 0 is special: never TVDB-created, episodeCount unreliable — delete when owned = 0.

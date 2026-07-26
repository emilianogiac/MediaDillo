---
name: Ghost Season 0 cleanup pattern
description: Season 0 ghost rows persist when cleanup is gated on orphaned.length > 0; affectedShowIds must be collected before deleting episode rows
type: feedback
---

Season 0 (Specials) ghost rows can outlive their EpisodeFiles across multiple scan passes.

**Rule**: Ghost Season 0 cleanup must run **unconditionally** — never inside an `if (orphaned.length > 0)` block.

**Why:** EpisodeFiles deleted in pass N leave Season row behind if season deletion fails for any reason. Pass N+1 sees zero orphaned files → skips the entire block → ghost row persists forever.

**How to apply:**
- In `pruneOrphanedFiles`, `runShowScan`, `runSeasonScan`: extract Season 0 cleanup to run after (not inside) the orphaned-files block.
- Pattern: `season.findFirst({ seasonNumber: 0 }) + _count.owned === 0 → deleteMany episodes + delete season`
- Also handle `runSeasonScan` early-return path (`!seasonFolderPath`): if season 0 and no folder found, still run ghost cleanup before returning.

**Collect showIds BEFORE deleting episode rows.**
In `pruneOrphanedFiles`, the `affectedShowIds` query used episode IDs that were deleted by ghost-season cleanup. Always collect showId before any `episode.deleteMany` call.

**episodeCount guard in syncAllSeasonsFromTvdb:**
The `if (seasonNumber === 0) continue` guard only covered the create path. The `else` (update) branch still wrote `episodeCount` on existing Season 0 rows. Guard must be `else if (seasonNumber !== 0)`.

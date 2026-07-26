# Bug Case: /missing page shows 100% complete shows as having missing episodes

Date: 2026-05-13
Status: Solved

## Symptoms

The /missing page lists shows (e.g. Poirot 1989) with 70/70 (100%) owned episodes yet still
displays "1 missing" badge. The show should not appear on this page at all.

## Root Cause

**Season 0 (Specials) episode rows with status='missing' are counted in the missing tally.**

Specifically, the `syncAllSeasonsFromTvdb` function in `enricher.ts` (lines 301-330) processes
ALL seasons returned by TVDB — including Season 0 when it already exists in the DB (e.g.
because the scanner previously found specials files). For each Season 0 episode TVDB knows
about that isn't in the DB yet, it creates a new episode row with `status='missing'`.

This violates the invariant that Season 0 is "owned-only" (no phantom missing rows should ever
be created for Specials). The `syncAllSeasonsFromTvdb` function correctly skips *creating*
a new Season 0 row (line 287: `if (seasonNumber === 0) continue`), but when Season 0 already
exists in the DB — which happens when the scanner has found specials files — it falls through
to the episode-creation loop (lines 301-330) and writes `status='missing'` rows for specials
episodes the user does not own.

The `/missing/shows` API route (missing.ts line 12) then finds these shows via:
  `seasons: { some: { episodes: { some: { status: 'missing' } } } }`
and counts all missing episodes across all seasons (line 41) including the Season 0 ghost rows.

## Investigation Notes

Flow for a show like Poirot with some owned specials:

1. Scanner discovers specials files → creates Season 0 row (episodeCount=0) + Episode rows
   with status='owned'.
2. User triggers enrich → `enrichTvShow` is called.
3. Line 59: `totalEpisodes: details.number_of_episodes` is written first (TMDB count, may or
   may not include specials — TMDB's `number_of_episodes` includes Season 0 for some shows).
4. `syncAllSeasonsFromTvdb` is called (line 91). It fetches all TVDB episodes.
5. For Season 0: `dbSeason` is found (exists from scanner). The `seasonNumber === 0` skip guard
   only prevents *creating* a new Season row — the episode loop still runs (line 301).
6. For each TVDB special that doesn't have a DB Episode row yet, a new row is created with
   `status = 'missing'` (line 308-316). These are specials the user doesn't own.
7. After `syncAllSeasonsFromTvdb` returns, the `hasSpecials` check triggers `syncSeasonFromTvdb`
   with `ownedOnly: true` (lines 94-97). But `syncSeasonFromTvdb` with `ownedOnly=true` only
   *skips creating* new episodes (line 201: `if (ownedOnly) continue`) — it does not delete or
   repair the `missing` rows that were already created in step 6.

End result: Season 0 has both `owned` rows (from scanner) and `missing` rows (from TVDB sync),
causing the show to appear on the /missing page with missingCount > 0 despite ownedEpisodes ==
totalEpisodes.

## Files & Line Numbers

- `apps/api/src/metadata/enricher.ts`
  - Lines 285-330: `syncAllSeasonsFromTvdb` — Season 0 episode loop lacks `ownedOnly` guard
  - Lines 87-98: `enrichTvShow` — calls `syncAllSeasonsFromTvdb` without Season 0 exclusion,
    then attempts to fix via `syncSeasonFromTvdb(ownedOnly:true)` but the damage is already done

- `apps/api/src/routes/missing.ts`
  - Lines 9-46: Query includes Season 0 missing episodes in the tally (correct behavior if
    the episode rows are correct — the bug is upstream in the enricher)

## Solution

In `syncAllSeasonsFromTvdb`, skip Season 0 episodes entirely in the episode-creation loop
when the season already exists. The existing guard `if (seasonNumber === 0) continue` at line 287
only prevents creating the Season row. Extend it to also skip the episode sync loop for Season 0.

The `ownedOnly` hydration that follows in `enrichTvShow` (lines 94-97) is the correct and only
path for Season 0 titles. `syncAllSeasonsFromTvdb` should never write Season 0 episode rows at all.

**Fix:** Move the `if (seasonNumber === 0) continue` guard to skip the entire season block in
`syncAllSeasonsFromTvdb`, not just the Season creation branch. The `continue` currently sits
inside the `if (!dbSeason)` block — it only fires when Season 0 doesn't exist yet. When it
does exist, the code falls through to episode upserts. The fix is to guard the episode loop:

```typescript
// In syncAllSeasonsFromTvdb, inside the for loop over bySeasonNumber:
if (seasonNumber === 0) {
  // Season 0 is scanner-created only. Episode rows are managed exclusively via
  // syncSeasonFromTvdb with ownedOnly:true. Never write missing rows for Specials here.
  continue
}
```

This replaces the existing `if (!dbSeason) { if (seasonNumber === 0) continue; ... }` pattern.

## Prevention

- Season 0 should be treated as completely read-only in `syncAllSeasonsFromTvdb`. Any function
  doing a bulk "all seasons" TVDB sync must skip Season 0 entirely — the ownedOnly pass that
  follows is the correct and only path for Specials hydration.
- Add a test that: (1) creates a show with a scanner-created Season 0 (owned episodes), (2) calls
  `syncAllSeasonsFromTvdb` with TVDB data that includes specials, (3) asserts no
  `status='missing'` rows exist under Season 0 afterward.

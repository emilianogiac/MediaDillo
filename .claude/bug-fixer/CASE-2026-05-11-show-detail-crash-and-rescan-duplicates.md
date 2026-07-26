# Bug Case: Show Detail Page Crash + Post-Rescan Duplication
Date: 2026-05-11
Status: Solved

## Symptoms
1. Navigating to any show detail page (`/shows/:id`) fails to load — shows error state.
2. After a library rescan, every item in the Shows list appears duplicated.

## Root Cause

### Bug 1 — Show detail page crash
`GET /api/shows/:id` was not returning `scanRoots`, `isDuplicate`, `duplicateCount`, or `isOrganized` in its response. These fields were added to `ShowSummary` (and by extension `ShowDetail`) in commit `710304c` for the multi-library UX feature, but only the list endpoint (`GET /api/shows`) was updated — the detail endpoint was not.

`ShowDetailPage.tsx` line 293 accesses `show.scanRoots.length`, which throws `TypeError: Cannot read properties of undefined (reading 'length')` since `scanRoots` was undefined on the raw Prisma object. React renders the error fallback instead of the show detail.

### Bug 2 — Post-rescan duplication in show list
Two separate issues:

**2a. Missing trailing slash in scanRoots path matching (backend)**
`GET /api/shows` builds a `showScanRoots` map by checking which scan roots contain each show's episode files. The `startsWith` comparison at line 131 used `root.path` without a trailing separator:
```ts
path: { startsWith: root.path }
```
If two scan roots have paths like `/data/tv` and `/data/tv-foreign`, a file at `/data/tv-foreign/Show/...` incorrectly matches the `/data/tv` root (because the string `/data/tv-foreign/...` starts with `/data/tv`). This causes shows to be assigned to multiple scan roots and get split into duplicate rows by the frontend `displayShows` flatMap logic.

Same problem exists at line 73 for the scanRootId filter query.

**2b. Wrong React key in grid view (frontend)**
`ShowsPage.tsx` grid view used `key={show.id}` instead of `key={show.listKey}`. When a show is exploded into multiple `DisplayShow` entries (one per library), both entries share the same `show.id`. React emits a duplicate-key warning and renders both cards, causing visible duplication in grid mode.

## Investigation Notes
- Introduced in commit `710304c` ("feat(shows): 4 UX improvements — deselect on filter, multi-library split, list details, Jellyfin link")
- The list endpoint was correctly updated to build `scanRoots`, but the detail endpoint was overlooked
- The `startsWith` without trailing slash is a classic path-prefix ambiguity bug

## Solution

### Bug 1 — Added scanRoots + derived fields to detail endpoint
In `GET /api/shows/:id` (`apps/api/src/routes/shows.ts`), after building seasons:
1. Query all scan roots and use `episodeFile.findFirst` with `startsWith: rootPath + '/'` to detect membership
2. Count duplicate tmdbId records for `isDuplicate`/`duplicateCount`
3. Include `scanRoots`, `isDuplicate`, `duplicateCount`, `isOrganized` in the response

### Bug 2a — Trailing slash fix for path prefix matching
Both `startsWith: scanRootPath` and `startsWith: root.path` uses now append `'/'` if not already present:
```ts
root.path.endsWith('/') ? root.path : root.path + '/'
```

### Bug 2b — Grid view key fixed
Changed `key={show.id}` to `key={show.listKey}` in the grid view renderer.

## Files Changed
- `/Users/yoda/Projects/MediaDillo/apps/api/src/routes/shows.ts` — detail endpoint + path matching fixes
- `/Users/yoda/Projects/MediaDillo/apps/web/src/pages/ShowsPage.tsx` — grid key fix

## Prevention
- When adding fields to a shared type (`ShowSummary`/`ShowDetail`), audit all API endpoints that return that type — not just the list endpoint
- Path prefix comparisons in DB queries should always use a trailing separator to avoid false prefix matches
- React list keys must use the same unique identifier as the array deduplication key (`listKey` in this case)

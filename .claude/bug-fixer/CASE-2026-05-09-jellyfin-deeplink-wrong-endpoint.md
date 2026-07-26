# Bug Case: Jellyfin Deep-Link Sync Fails — Wrong /Items Endpoint

Date: 2026-05-09
Status: Solved

## Symptoms

Clicking "Jellyfin" on the movie detail page either shows "Movie not found in Jellyfin" or uses the slow
live-lookup path every time, even after a sync. The fast path (stored `jellyfinId`) never fires because
`jellyfinId` is always `null` in the database.

## Root Cause

`JellyfinClient.getAllMoviesWithIds()` was calling the admin-only `/Items` endpoint:

```
GET /Items?IncludeItemTypes=Movie&Recursive=true&Fields=ProviderIds
```

Jellyfin 10.8+ deprecated this admin endpoint. On most installs it returns 401/403 for non-admin API
keys, causing `syncJellyfinIds()` to throw and swallow the error silently. Every other item-listing
method in the client (`getWatchedMovieTmdbIds`, `getWatchedEpisodePaths`) correctly uses the
user-scoped path `/Users/{userId}/Items`.

## Investigation Notes

- commit 80a1858 introduced `getAllMoviesWithIds` and the fast-path deep-link
- commit 1cbe183 fixed a different bug (findFirst → updateMany for sibling stamping)
- Neither commit caught the wrong endpoint
- The `syncJellyfinIds` error is swallowed by the catch block, so the failure is silent
- Inspecting other client methods confirmed the correct pattern: always `/Users/{userId}/Items`

## Solution

Two-file fix:

**`apps/api/src/jellyfin/client.ts`** — added `userId: string` parameter to `getAllMoviesWithIds`,
changed endpoint from `/Items` to `/Users/${userId}/Items`.

**`apps/api/src/jellyfin/sync.ts`** — updated `syncJellyfinIds` to call `client.getUsers()` first
(same pattern as `jellyfinRoutes`'s watched endpoint), then pass `users[0].Id` to `getAllMoviesWithIds`.
Returns early if no users found.

Also added a test to `client.test.ts` asserting the user-scoped URL is used.

## Prevention

- Never call bare `/Items` in Jellyfin client — always prefix with `/Users/{userId}/Items`
- All silent catch blocks in sync utilities should log at warn level (this one already does)
- When a "fast path" feature is added, add an integration-style test that verifies the DB field
  actually gets populated, not just that the URL generation is correct

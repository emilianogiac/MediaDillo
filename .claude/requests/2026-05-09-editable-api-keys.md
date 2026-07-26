# Editable API Keys from Settings UI

**Date**: 2026-05-09
**Status**: Planned

## Original Request

Make TMDB, TVDB, and Jellyfin API keys/URLs editable from the Settings UI instead of only via environment variables.

## Research Findings

### Current State

**Config loading** (`apps/api/src/config.ts`):
- All API keys read from `process.env` at startup via Zod schema
- `TMDB_API_KEY`, `TVDB_API_KEY`, `JELLYFIN_URL`, `JELLYFIN_API_KEY` — all optional
- `METADATA_LANGUAGE` also from env (default `it-IT`)
- The parsed `config` object is a frozen singleton — modules import and read it directly

**Consumers** (all in `apps/api/src/`):
- `routes/metadata.ts` — creates `TmdbClient(config.TMDB_API_KEY, config.METADATA_LANGUAGE)` on each request
- `routes/artwork.ts` — passes `config.TMDB_API_KEY` to image searchers
- `routes/missing.ts` — creates `TmdbClient(config.TMDB_API_KEY)`
- `routes/library-health.ts` — creates `TmdbClient(config.TMDB_API_KEY, config.METADATA_LANGUAGE)`
- `routes/jellyfin.ts` — `getClient()` reads `config.JELLYFIN_URL` + `config.JELLYFIN_API_KEY` per-request
- `jellyfin/sync.ts` — same pattern as above
- `metadata/tvdb-client.ts` — stub, not wired up yet

**Key observation**: All consumers already instantiate clients per-request (or per-call). Nobody caches a long-lived client from startup config. This means swapping the config source to DB is safe — no stale singletons.

**Existing Setting model** (`prisma/schema.prisma`):
```prisma
model Setting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```
Already used for `scan.schedule` and `match.autoCleanupFolder`. Simple key-value store — perfect for API keys.

**Settings UI** (`apps/web/src/pages/SettingsPage.tsx`):
- Currently has a static "API Keys" card that just shows text saying "configure via .env"
- Pattern: each section is a card component (JellyfinCard, ScanRootsCard, ScheduleCard, etc.)
- API client layer in `apps/web/src/api/settings.ts` uses `apiFetch` helper

**Settings routes** (`apps/api/src/routes/settings.ts`):
- GET/PUT pattern for schedule and auto-cleanup
- Uses `prisma.setting.upsert` for writes
- No existing API key endpoints

## Implementation Plan

### Architecture Decision

Store API keys in the `Setting` table with keys like `apiKey.tmdb`, `apiKey.tvdb`, `jellyfin.url`, `jellyfin.apiKey`, `metadata.language`. On first boot, seed from env vars if DB values are empty (migration path).

Create a `getApiConfig()` helper that checks DB first, falls back to env. All existing `config.TMDB_API_KEY` references get replaced with calls to this helper.

### Task Breakdown

#### Issue 1: API config resolver — DB-first with env fallback (S)
**File**: `apps/api/src/api-config.ts` (new)

- Create async `getApiConfig()` that reads the 5 keys from `prisma.setting`, falls back to `config.*` env values
- Return typed object: `{ tmdbApiKey, tvdbApiKey, jellyfinUrl, jellyfinApiKey, metadataLanguage }`
- Cache in-memory with a short TTL (e.g. 30s) or invalidate on write — avoids hitting DB on every request
- Add `seedApiConfigFromEnv()` — on app startup, for each key, if DB row is missing AND env var is set, insert the env value

**Acceptance criteria**:
- `getApiConfig()` returns DB values when present
- Falls back to env when DB row is missing
- `seedApiConfigFromEnv()` populates DB from env on first run, does not overwrite existing DB values
- Unit tests for fallback logic

#### Issue 2: Settings API endpoints for API keys (S)
**File**: `apps/api/src/routes/settings.ts`

- `GET /api/settings/api-keys` — returns all 5 values, with keys masked (show last 4 chars only, e.g. `"****abcd"`)
- `PUT /api/settings/api-keys` — accepts partial updates (only provided fields are written)
- `POST /api/settings/api-keys/test-jellyfin` — takes `{ url, apiKey }`, calls `testJellyfinConnection()`, returns status (allows testing before saving)
- `POST /api/settings/api-keys/test-tmdb` — takes `{ apiKey }`, makes a single TMDB `/configuration` call to validate
- Invalidate the in-memory cache on PUT
- Zod validation on inputs

**Acceptance criteria**:
- GET returns masked keys
- PUT persists to DB and invalidates cache
- Test endpoints validate connectivity without persisting
- Invalid/empty values rejected with 400

#### Issue 3: Replace config.* references with getApiConfig() (S)
**Files**: `routes/metadata.ts`, `routes/artwork.ts`, `routes/missing.ts`, `routes/library-health.ts`, `routes/jellyfin.ts`, `jellyfin/sync.ts`

- Replace all `config.TMDB_API_KEY` / `config.JELLYFIN_*` reads with `await getApiConfig()`
- Since all consumers already create clients per-request, this is mechanical
- Keep `config.ts` env schema but make the API key fields truly optional (they already are)

**Acceptance criteria**:
- No direct `config.TMDB_API_KEY` / `config.JELLYFIN_*` references remain (except in seed logic)
- All existing tests pass (mock `getApiConfig` where needed)

#### Issue 4: API Keys card in Settings UI (M)
**File**: `apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/api/settings.ts`

- Replace the static "API Keys" info card with an editable form
- Fields: TMDB API Key, TVDB API Key, Jellyfin URL, Jellyfin API Key, Metadata Language
- Keys displayed masked by default; "reveal" toggle per field
- "Test" button for TMDB and Jellyfin that hits the test endpoints
- "Save" button that PUTs changes
- Success/error feedback (reuse existing card patterns — inline green/red text)
- Only send changed fields on save

**Acceptance criteria**:
- Keys load masked on page open
- User can reveal, edit, test, and save each key
- Test button shows connection status (green dot + server info for Jellyfin)
- Empty fields are accepted (clears the key)
- Existing SettingsPage tests updated

#### Issue 5: Seed on startup + integration test (XS)
**File**: `apps/api/src/index.ts` (or app startup)

- Call `seedApiConfigFromEnv()` during app bootstrap, before routes register
- One integration test: start with env vars set, verify DB seeded, clear env, verify DB values still returned

**Acceptance criteria**:
- Existing installs with .env keys seamlessly migrate on first restart
- Keys in DB survive env var removal

## Security Notes

- Keys masked in GET response (last 4 chars only) — full value never returned to frontend after initial save
- No API keys logged (already the case — config.ts doesn't log values)
- Internal tool on private network — no auth layer needed beyond what exists
- Test endpoints take the candidate key as input (not from DB) so you can validate before committing

## Dependency Order

```
Issue 1 (resolver) → Issue 3 (rewire consumers) → Issue 5 (seed)
                   → Issue 2 (API endpoints)     → Issue 4 (UI)
```

Issues 2 and 3 can run in parallel after Issue 1. Issue 4 needs Issue 2. Issue 5 needs Issue 1.

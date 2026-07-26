# Bug Case: Batch Rematch — No Progress Feedback + Wrong Language
Date: 2026-05-07
Status: Investigating

## Symptoms

**Bug 1:** User sees no progress during batch re-matching. The toast system exists and the JobToast UI component is fully built, but the UI never updates — the user must manually refresh to see any results.

**Bug 2:** Batch re-matching fetches metadata in English instead of the user's configured language (Italian > English, i.e., `it-IT` fallback to `en-US`).

---

## Root Cause

### Bug 1 — Toast polling never fires after job completes

The `ToastContext` polling loop has a **stale closure bug**.

In `/apps/web/src/context/ToastContext.tsx`, the `useEffect` that polls job status captures the `running` snapshot at the time the effect fires. But the dependency array is `[toasts, dismiss]`, which means every time `setToasts` is called (i.e., every 2-second poll response), the effect tears down and re-creates the interval. This itself isn't the root problem.

The actual bug is on **line 52**:

```ts
const running = toasts.filter((t): t is JobToast => t.type === 'job' && (t.job === null || t.job.running))
```

This `running` array is captured by the closure on the `setInterval` callback (line 56). On **the first poll**, the interval fires, fetches the status, calls `setToasts`, which triggers a re-render. The effect cleans up the old interval and starts a new one — all fine so far.

**However**: the `running` list inside the `setInterval` callback is the one from the *outer* effect scope, not the updated one. Because the interval is recreated on each `toasts` change, a single-item job works, but there is a subtler timing problem: if `status.running` becomes `false` on a poll, the code calls `setTimeout(() => dismiss(jt.id), 5000)` — but **it does not update the toast's `job` field to the final state before dismissing**. The `setToasts` update on line 59 fires with `status` (which has `running: false`), but then the next `useEffect` run sees `t.job.running === false` and excludes it from `running`, so the interval stops polling. That part is technically fine.

**The actual broken scenario**: when `trackJob` is called from `MoviesPage.handleBatchRematch`, a `JobToast` is pushed to state with `job: null`. The effect fires, sees one running toast, starts an interval. The interval calls `fetchJobStatus(jt.jobId)`. If the API call returns immediately with `running: false` (e.g., a very fast job or an error), `status.running` is false, `dismiss` is scheduled for 5s, and `setToasts` updates the toast. **But the progress bar never visually advances from 0%** because:

- `pct` in `JobToastItem` is calculated as `job.done / job.total * 100`
- If `job` is still `null` when the first paint happens (before the first 2s poll), the bar shows 0% and "starting..."
- The label only updates after the *first* poll response arrives

**More critically**: the real-world broken scenario is when the component unmounts during a job. If the user navigates away from `MoviesPage` while a rematch job is running, the `ToastProvider` itself stays mounted (it's in `App.tsx` above the router), so the polling keeps working. But `trackJob` returns **no mechanism to reload the movie list when the job completes** — the job finishes silently, and because `MoviesPage` is no longer mounted, `load()` is never called. When the user returns to the page, they see stale data until a manual refresh.

**Summary of Bug 1**: The toast and its polling are wired up correctly at the infrastructure level. The missing piece is a **post-job completion data reload**. `trackJob` has no callback parameter — there is no way to tell `MoviesPage` "the job is done, reload now." The toast dismisses itself 5s after completion, but nothing triggers `load()` in `MoviesPage`.

---

### Bug 2 — Batch rematch ignores `METADATA_LANGUAGE`, always uses `en-US`

In `/apps/api/src/routes/library-health.ts`, line 289:

```ts
const client = new TmdbClient(config.TMDB_API_KEY)
```

`TmdbClient` constructor signature (in `tmdb-client.ts`, line 98):

```ts
constructor(apiKey: string, language = 'en-US') {
```

The second argument `language` is **omitted** when creating the client for the batch rematch endpoint. It defaults to `'en-US'`.

Compare this to **every other place** a `TmdbClient` is instantiated:

- `apps/api/src/routes/metadata.ts`, line 13 — `getTmdbClient()` helper:
  ```ts
  return new TmdbClient(config.TMDB_API_KEY, config.METADATA_LANGUAGE)
  ```
- `apps/api/src/metadata/index.ts` — likely uses the same helper or passes `config.METADATA_LANGUAGE`

The batch rematch route (added in the "persistent job progress toast" commit) did **not** use the shared `getTmdbClient()` helper from `metadata.ts`. Instead, it inlined `new TmdbClient(config.TMDB_API_KEY)` directly — and forgot to pass the language parameter. Since `config.METADATA_LANGUAGE` defaults to `'it-IT'` per the schema, all single-item matches work in Italian, but all batch rematches hit TMDB in English.

---

## Investigation Notes

Files examined:
- `/apps/api/src/routes/library-health.ts` — the batch rematch endpoint
- `/apps/api/src/routes/metadata.ts` — the single-item rematch endpoint (correct pattern)
- `/apps/api/src/metadata/tmdb-client.ts` — TmdbClient constructor
- `/apps/api/src/config.ts` — METADATA_LANGUAGE default is `'it-IT'`
- `/apps/api/src/health/job-tracker.ts` — job state machine (correct)
- `/apps/web/src/context/ToastContext.tsx` — toast + polling (wired up but missing completion callback)
- `/apps/web/src/pages/MoviesPage.tsx` — handleBatchRematch calls trackJob but has no reload-on-complete
- `/apps/web/src/components/ToastStack.tsx` — JobToastItem renders correctly
- `/apps/web/src/App.tsx` — ToastProvider is at root (correct)

---

## Solution

### Fix for Bug 2 (language — 1-line fix)

In `/apps/api/src/routes/library-health.ts`, line 289, change:

```ts
const client = new TmdbClient(config.TMDB_API_KEY)
```

to:

```ts
const client = new TmdbClient(config.TMDB_API_KEY, config.METADATA_LANGUAGE)
```

### Fix for Bug 1 (post-completion reload)

`trackJob` in `ToastContext` needs an optional `onComplete` callback. When the polling loop detects `!status.running`, it should invoke `onComplete()` before scheduling the dismiss.

In `MoviesPage.handleBatchRematch`, pass `onComplete: () => load()` to `trackJob`.

Changes required:
1. `ToastContext.tsx` — add `onComplete?: () => void` to `trackJob` opts; store per-toast; invoke it when polling detects completion
2. `MoviesPage.tsx` — pass `onComplete: () => { load(); setListNonce(Date.now()) }` in the `trackJob` call

---

## Prevention

- Use a shared `getTmdbClient()` helper (already exists in `metadata.ts`) everywhere a `TmdbClient` is needed — never inline `new TmdbClient(config.TMDB_API_KEY)` without the language argument
- Job-tracking `trackJob` should always support a completion callback so callers can react to job finish; without it, the progress toast becomes purely cosmetic

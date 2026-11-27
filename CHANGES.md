# Changes

## 2026-11-27 — Season 0 no longer reads "owned/0" (#95)

**Problem.** A fully-owned specials season displayed as `4/0 episodes` with a
0% progress bar, and every special was painted as out-of-bounds.

`Season.episodeCount` is 0 for season 0 and stays that way deliberately —
`apps/api/src/metadata/enricher.ts` refuses to write it in `ownedOnly` mode
because the provider's per-season API returns unreliable results for specials.
The UI then divided by that zero in three places.

**Change.** Treat season 0 as uncountable rather than inventing a denominator.
A count of "all specials that exist" is not a target anyone aims at, and it is
exactly the data the enricher already distrusts.

- `ShowDetailPage` — a season with no known `episodeCount` renders a plain
  count (`4 episodes`, singularised at 1) and no progress bar.
- `SeasonDetailPage` — the heading shows `4 owned` rather than `4/0 owned`,
  and the out-of-bounds check is skipped when there is no known bound.
- The enricher's `ownedOnly` guard is untouched; it is correct.

**Tests.**

- `apps/web/src/pages/SeasonZeroDisplay.test.tsx` — plain count for specials,
  ratio preserved for normal seasons, singular/plural, and the same fallback
  for any season with an unknown count.
- `apps/web/src/pages/SeasonDetailPage.test.tsx` — specials are not flagged
  out-of-bounds, the heading drops the zero denominator, and a genuinely
  out-of-range episode in a normal season is still flagged.

**Incidental repairs.** `ShowDetailPage.test.tsx` and `SeasonDetailPage.test.tsx`
were already failing on `main` (16 tests) for reasons unrelated to this change:
the pages gained `useToast` and extra API imports, but the tests never wrapped
in `ToastProvider` and their `vi.mock` factories replaced whole modules without
spreading the original. Repaired both, and corrected a stale assertion that
expected the owned denominator to be the row count rather than `episodeCount`.

Suite: **53 failed / 302 passed before → 39 failed / 323 passed after.** The
remaining 39 failures are the same harness rot in five untouched pages
(Settings, Shows, Movies, MovieDetail, Dashboard) and are tracked separately.
## 2026-11-27 — Episode title locks are visible and operable (#101)

**Problem.** #96 protects a hand-corrected episode title from enrichment, but
nothing surfaced it. You could not tell a protected title from an unprotected
one, could not correct a title from the UI at all, and could not undo the
protection without calling the API by hand.

**Change.** New `EpisodeTitleInline` component, used for every episode row on
the season detail page:

- a `manual` title carries a **🔒 Locked** badge, with a tooltip explaining
  that metadata refreshes will not overwrite it
- **Edit** saves a corrected title and locks it
- **Unlock** hands the title back to the provider, so the lock is escapable

Supporting work: `EpisodeDetail.titleSource` added to the web types, and
`updateEpisodeTitle()` / `resetEpisodeTitle()` added to the shows API client.
The season endpoint already returned the field, so no API change was needed.

Per-episode, not per-show: locking a whole show would freeze titles that
genuinely should keep updating.

**Tests.** `apps/web/src/components/EpisodeTitleInline.test.tsx` — badge shown
only for manual titles, the tooltip explains the lock, saving calls the update
endpoint and reports back, unlocking calls the reset endpoint, empty titles are
refused, cancel is a no-op, and a title-less episode falls back to a
placeholder. 8 tests.

## 2026-11-27 — Manual episode titles survive enrichment (#96)

**Problem.** Enrichment overwrote `Episode.title` unconditionally, so any
human correction was destroyed by the next refresh. Refreshes are not always
user-initiated: a successful rename calls `triggerLibraryRefresh()`
(`apps/api/src/routes/files.ts:51`), which re-enriches the show.

This was a live hazard. I Puffi (tvdbId 75719) has 31 episode titles corrected
by hand, because TVDB's Italian list for that show is mis-attributed — the
Italian title at a given DVD number frequently belongs to a different episode,
with no consistent offset. Those titles were one automatic refresh away from
being silently replaced with wrong data.

**Change.**

- `Episode.titleSource` (`provider` | `manual`, default `provider`) records
  where a title came from — new `TitleSource` enum in the Prisma schema.
- `episodeSyncData()` in `apps/api/src/metadata/enricher.ts` builds the sync
  payload and omits `title` when `titleSource = manual`. Air date and status
  still sync. Applied at all three enrichment paths (TVDB per-season, TVDB
  absolute, TMDB).
- `PATCH /api/missing/shows/:showId/episodes/:episodeId/title` sets a title and
  marks it `manual`; `{ reset: true }` hands it back to the provider so the
  lock is escapable.

Per-episode rather than per-show: a show can carry a few corrected titles and
still benefit from enrichment everywhere else.

**Tests.**

- `apps/api/src/metadata/episode-sync-data.test.ts` — provider titles are
  written, manual titles are omitted, airDate/status still sync, and a null
  provider title cannot erase a manual one.
- `apps/api/src/routes/episode-title.test.ts` — the endpoint marks titles
  manual, trims whitespace, resets provenance, rejects empty titles, and 404s
  across shows.

Full API suite: 270 passing.

**Deploy note.** Schema change — run
`docker compose exec app sh -c "cd packages/db && npx prisma db push"`.
Existing rows default to `provider`, which preserves today's behaviour.

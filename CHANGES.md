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

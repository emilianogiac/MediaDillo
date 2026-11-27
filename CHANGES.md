## 2026-11-27 — merging parts no longer strands their sidecars

**Issue #79.** `mergeMovieParts` trashed the two video files and nothing else, so
every sidecar named after a part survived pointing at a video that no longer
existed. Merging 24 films on the Milan library left 39 orphaned `.nfo` files
(2 × `part1.nfo`, 37 × `part2.nfo`). `part1.nfo` mostly escaped notice only by
luck: the NFO writer re-creates `<Title> (Year).nfo` for the merged output, which
happened to overwrite it. `part2.nfo` had no such collision and was always
stranded.

Same class as #71 — a destructive file operation reasoning about the video and
nothing named after it.

`retirePartSidecars` now retires each part's sidecars into the same `.trash` as
the parts, so one trash entry holds the complete original state. It runs after
the output has been probed and verified (#77), so a merge that fails
verification leaves the parts *and* their sidecars untouched; the retired paths
go into the activity log entry alongside the merged parts.

Subtitles are retired too, not retargeted. A subtitle for part1 is timed to the
first half only: renaming it onto the merged file would leave the first half
correct and the second half unsubtitled, which is worse than absent. Offsetting
and concatenating subtitles is a separate job.

Selection is `sidecarsOfBasename` in `files/sidecars.ts`, sharing
`belongsToEpisode` with the episode rename so merge and rename cannot disagree
about what belongs to a video. It is stricter than the rename's bare
`startsWith`: the character after the basename must be `.`, `-` or `_`, because
this list is handed to `deleteToTrash` and a loose prefix match would let
`Movie - part1` claim `Movie - part10.srt`. Folder-level artwork and `movie.nfo`
carry no part basename and survive, which matters because the merged file lands
in that same folder and goes on using them.

Tests: `apps/api/src/files/merge.test.ts` — the selection on a real temp folder,
and `mergeMovieParts` itself with ffmpeg/ffprobe stubbed, asserting that a
verified merge retires all four originals into one `.trash` and that both a
failed verification and an unmergeable pair leave all six files in place.
Selection rules in `apps/api/src/files/sidecars.test.ts`.

## 2026-11-27 — the stale detector stops condemning canonical files

**Issue #94**, following #92. Of the 84 files the detector still flagged on the
Milan library, triage against the filesystem found only 26 genuinely stale. The
remaining 58 were canonical files the detector had no rule for, and the feature
offers a bulk delete.

Four gaps, all closed:

- **Episode NFOs (19 files).** Kodi and Jellyfin name an episode's NFO after its
  video, not `episode.nfo`. An `.nfo` sitting beside a video of the same basename
  is now recognised as that video's NFO.
- **`season.nfo` (1 file).** Standard season metadata, absent from the canonical
  list.
- **`logo.svg` (9 files).** `KNOWN_ARTWORK` had `logo.png` and `logo.jpg` but not
  the SVG spelling, which `files/sidecars.ts` had listed all along. It is now
  also accepted as the canonical counterpart of a `-logo` suffixed file.
- **Unsuperseded landscape art (9 files).** `-landscape` resolved to
  `backdrop.jpg`, so a suffixed landscape was called redundant whenever a
  backdrop existed. They are different images: for nine films the suffixed file
  was the only landscape artwork in the folder and deleting it would have lost it
  outright. `-landscape` now requires `landscape.jpg` itself.

Two distinctions the fix turns on, both of which cost a round to find:

`CANONICAL_NFO` was doing two jobs — "never stale" and "proof MediaDillo has
taken this folder over, so foreign NFOs here are superseded". Adding `season.nfo`
to a single set would have made its presence start condemning a season folder's
other NFOs, so the sets are now separate.

And a video-named NFO is not canonical unconditionally: `movie.nfo` beside
`Iron Man (2008).mkv` means `Iron Man (2008).nfo` really is the duplicate the
triage confirmed as stale. Only the per-item NFOs (`movie.nfo`, `episode.nfo`)
supersede a video-named one; `tvshow.nfo` describes the show rather than the
episode next to it, so episode NFOs in a season folder survive. Without that
distinction the fix spared all 26 real positives too.

Tests: `apps/api/src/scanner/stale-detector.test.ts`, including the real
`/mnt/nas/film/Iron Man (2008)` listing, which carries every shape in the issue
at once — two videos, two video-named NFOs, two suffixed landscapes, `movie.nfo`
present and no `landscape.jpg`.

Not changed: `-background`, which `files/sidecars.ts` recognises and the stale
detector does not, so `<title>-background.jpg` still reports as unrecognized.
Out of scope here and unmeasured against the library.

## 2026-11-27 — file duration is finally recorded

**Issue #108.** `durationS` was NULL on all 10,700 `EpisodeFile` and 1,649
`MovieFile` rows while `videoCodec` and `videoResolution` were set on
essentially every one of them. The scanner's probe was not failing to store the
duration — it never asked for it. `extractTechSpecs` ran `ffprobe -show_streams`
with no `-show_format`, and `VideoTechSpecs` had no duration field at all.

That mattered more than a missing column usually does. Duration is the only
signal available that can contradict a filename: everything else is either the
thing under test or the provider the name came from, so a wrong title and a
wrong episode number agree with each other happily. A 44-minute file in a
22-minute season is a two-parter and a 90-second file is an opening sequence,
and until now there was no way to see either.

`parseFfprobeOutput` now reads the runtime from the first of three sources that
has it: `format.duration`, the video stream's own `duration`, and the
Matroska `DURATION` tag, which is a timecode rather than a number and is the
only one present on much of the TV library. Zero and `N/A` are treated as
absent rather than stored as 0. All six `EpisodeFile`/`MovieFile` write sites in
`db-sync.ts` persist it, and `needsDurationBackfill` makes a rescan rewrite a row
whose duration is still NULL — without it the existing change triggers (mtime,
codec, edition) are all unchanged for a correctly scanned file, so nothing would
ever heal the old rows.

For the 12,349 rows already in the database, `apps/api/src/scripts/backfill-durations.ts`
probes only the NULL ones, through a small worker pool, and is therefore safe to
interrupt and rerun:

```
docker compose exec app sh -c "cd apps/api && pnpm backfill:durations"
```

`--dry-run`, `--limit N` and `--concurrency N` are available. It is a script and
not a startup migration because 12k probes against the NAS must not block API
boot, and not a route because no request would survive it.

The season view now shows each file's runtime as a badge, and flags in amber any
file 1.5x away from the median runtime of the season's own files — the season's
files rather than a provider's declared runtime, which is often absent and
sometimes wrong. The median needs at least three known runtimes: with two, a
double-length file and its normal neighbour are equally "the median" and the
flag would fire on whichever sorted lower.

Tests: `apps/api/src/scanner/ffprobe.test.ts` (duration sources and fallbacks),
`apps/api/src/scanner/db-sync.test.ts` (persistence and the rescan heal),
`apps/api/src/scripts/backfill-durations.test.ts`,
`apps/web/src/pages/episodeRuntime.test.ts`,
`apps/web/src/pages/SeasonDetailPage.test.tsx`.

## 2026-11-27 — one definition of "organized"

**Issue #109.** A show could read "✓ Organized" on its own page and still sit in
the unorganized bucket on the shows list, caught by the unorganized filter.
`IT - Il pagliaccio assassino` and `Conte Dacula` both did: their episode files
were already canonical and only the folder name was wrong.

Two independent derivations of the same word were to blame. The shows list
compared the show's folder name to `Title (Year)`; the show page asked the
organize preview what was pending but filtered to `episode-file` items, throwing
away the `show-folder` item — the one thing the list looks at. Separately,
`GET /api/shows/:id` hardcoded `isOrganized: false`, so the field it shipped was
always wrong.

Now `isShowFolderCanonical` in `files/naming.ts` is the single definition, used
by both the list and the detail endpoint. The page badge moved into
`pages/organizeDots.ts`, which tracks folder renames as their own signal and only
reports organized when the preview has nothing left to do — strictly stronger
than the list's check, so the two can no longer contradict each other.

Tests: `apps/api/src/files/naming.test.ts` (8 new), `apps/web/src/pages/organizeDots.test.ts` (5).

## 2026-11-27 — enrichment survives a dead TMDB id and a concurrent run

**Issue #105 — a stale TMDB id no longer blocks TVDB.**
`enrichTvShow` opened with an unguarded `tmdbClient.getTv()`, so a deleted TMDB
id threw before any TVDB work ran. Two shows were stuck that way (The
Scooby-Doo Show (1976) → tmdbId 6172, Tom & Jerry → 3936), keeping
scanner-derived filename titles even though TVDB held the right Italian ones.
The TMDB fetch is now non-fatal whenever the show has a `tvdbId` and a TVDB
client is available; only the TMDB-sourced fields and credits are skipped.
`PUT /api/metadata/shows/:id` also re-enriches TVDB-only shows now — its
re-enrich was gated on `tmdbId`, so correcting a TVDB-only show's id did
nothing at all.

**Issue #106 — a concurrent enrich no longer abandons the sync.**
Episodes were written as `findFirst` + `create`, which races on the unique
`(seasonId, episodeNumber)` key when two enrichments of the same show overlap —
easily reached, because a `tvdbId`/`tvdbOrder` change starts one in the
background. The P2002 aborted the rest of the run and left the show
half-updated. All three create sites now go through `createOrSyncEpisode`,
which treats the conflict as the update case and routes it through
`episodeSyncData` so a locked title (#96) still survives.
`syncSeasonFromTvdb` also dedupes by episode number now, matching
`syncAllSeasonsFromTvdb`: TVDB repeats some `(season, number)` pairs — series
272472's `alternate` order lists S11E14 and S11E28 twice.

Tests: `apps/api/src/metadata/enrich-resilience.test.ts` (9).

# Changes

## 2026-11-27 — Add a Lock action for titles that are already correct (#103)

**Problem.** #101 shipped **Edit** and **Unlock** but no **Lock**, so locking
only happened as a side effect of saving an edited title. A provider title that
was already correct could not be protected without first changing it into
something else and back. The obvious workaround — open the editor and save
without changing anything — silently did nothing, because `save()` returned
early when the text was unchanged.

**Change.**

- **Lock** action, shown when the title is provider-owned, marks it `manual`
  without altering the text.
- Disabled when the episode has no title (the endpoint rejects empty titles),
  with a tooltip saying why.
- Saving unchanged text now still locks an unlocked episode; on an already
  locked one it stays a no-op.

**Tests.** 6 added to `EpisodeTitleInline.test.tsx` (14 total): Lock offered
only when unlocked, locks the existing title unchanged, disabled without a
title, and both unchanged-save paths.

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

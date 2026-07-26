# Bug Case: Episodes 100+ treated as duplicates of episode 10

Date: 2026-05-10
Status: Solved

## Symptoms

"L'uomo tigre" Season 1 (105 episodes) showed episodes 100–105 as duplicates of episode 10.
Specifically:
- `S01E100` was parsed as episode 10 (with a trailing `0` left over in the filename)
- `S01E101` was parsed as episode 10 with a leftover `1`, matching the multi-part heuristic → episode 10 part 1
- Same pattern for E102–E105

## Root Cause

`TV_SE_RE` in `apps/api/src/scanner/filename-parser.ts` used `\d{1,2}` for episode digits — capped at 2 digits. Regex is greedy so `S01E100` matched `S01E10` (consumed exactly 2 digits), leaving the trailing `0` as unmatched suffix in the filename.

The season quantifier (`\d{1,2}`) is correct (no real-world show has 100+ seasons), but episodes absolutely can exceed 99 for long-running series.

## Investigation Notes

- Line 9 (original): `[Ee](\d{1,2})(?:[._-]?[Ee](\d{1,2}))*`
- The `{1,2}` quantifier means the match stops after 2 digits maximum — greedy within that bound.
- `E100` → regex grabs `E10`, stops; remaining `0` is left in `afterSE`.
- `E101` → grabs `E10`, remaining `1` → after normalization this was being interpreted as part number.
- The `NxNN` and `Season N Episode N` alternate branches had the same `\d{1,2}` episode cap.

## Solution

Changed `\d{1,2}` to `\d{1,3}` for all episode number capture groups in `TV_SE_RE`. Season cap kept at `\d{1,2}`.

```typescript
// Before
/(?:[Ss](\d{1,2})[._-]?[Ee](\d{1,2})(?:[._-]?[Ee](\d{1,2}))*|(\d{1,2})x(\d{1,2})|[Ss]eason\s+(\d{1,2})\s+[Ee]pisode\s+(\d{1,2}))/

// After
/(?:[Ss](\d{1,2})[._-]?[Ee](\d{1,3})(?:[._-]?[Ee](\d{1,3}))*|(\d{1,2})x(\d{1,3})|[Ss]eason\s+(\d{1,2})\s+[Ee]pisode\s+(\d{1,3}))/
```

## Tests Added

7 new cases in `apps/api/src/scanner/filename-parser.test.ts`:
- `S01E100` → episodes [100]
- `S01E101` → episodes [101]
- `S01E105` → episodes [105]
- `S01E10` (unchanged) → episodes [10]
- `S01E009` → episodes [9]
- `S01E100E101` (multi-episode) → episodes [100, 101]
- `S01E10E11` (multi-episode, 2-digit) → episodes [10, 11]

All 154 tests pass after the fix.

## Prevention

When writing episode/season regex patterns, always consider shows with 100+ episodes (anime, telenovelas, long-running series). Use `\d{1,3}` for episode digits as a safe upper bound. A `{1,2}` cap silently truncates without error — the regex matches successfully but on a shorter substring, leaving trailing digits that corrupt later parsing.

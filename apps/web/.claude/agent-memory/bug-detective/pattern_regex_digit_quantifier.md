---
name: Regex digit quantifier — episode numbers
description: \d{1,2} silently truncates 3-digit episode numbers in TV filename parsers; use \d{1,3} for episodes
type: feedback
---

In `apps/api/src/scanner/filename-parser.ts`, episode digit quantifiers must be `\d{1,3}`, not `\d{1,2}`.

**Why:** A `{1,2}` cap causes the regex to match `E10` from `E100`, leaving the trailing `0` in the unparsed suffix. No error is thrown — the match succeeds silently on the wrong substring. Long-running anime and telenovelas routinely exceed 99 episodes per season.

**How to apply:** Whenever writing or reviewing TV S/E regex patterns, use `\d{1,3}` for episode captures. Season stays `\d{1,2}` (no real-world show has 100+ seasons).

# Bug Detective Memory Index

- [Scanner routing pattern](scanner_routing.md) — scan root `type` must drive sync routing; never trust filename parser alone
- [Ghost Season 0 cleanup pattern](ghost_season0_cleanup.md) — cleanup must be unconditional (never gated on orphaned.length); collect showIds before deleting episode rows

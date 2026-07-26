---
name: MediaDillo project context
description: Full project background, stack, ports, NAS setup, working conventions, and doc style for MediaDillo
type: project
---

MediaDillo is a self-hosted media library manager for Jellyfin, replacing TinyMediaManager. It manages movies and TV shows stored on a NAS.

**Why:** User runs Jellyfin on a Linux VM with a NAS-backed media library and needed a purpose-built manager.

**Stack:**
- Frontend: React + TypeScript + Tailwind (Vite), package `@mediadillo/web` at `apps/web/`
- Backend: Node.js 20 + Fastify, package `@mediadillo/api` at `apps/api/`
- DB: PostgreSQL 16 + Prisma, package `@mediadillo/db` at `packages/db/`
- Monorepo: pnpm workspaces
- Deploy: Docker Compose (single `Dockerfile`, multi-stage, ffmpeg included for ffprobe)

**Ports:**
- App (API + frontend served together): 7731
- Postgres exposed on host: 7732 (maps to container 5432)

**NAS mount:** `/mnt/nas` — mounted `:rw` in `docker-compose.yml`. Multiple scan roots configured via `SCAN_ROOTS` env var (JSON array).

**Key env vars:** `DB_PASSWORD`, `TMDB_API_KEY` (required), `TVDB_API_KEY`, `JELLYFIN_URL`, `JELLYFIN_API_KEY` (all optional). `DATABASE_URL` is set automatically by Compose.

**DB management:** `pnpm db:push` for schema push; `pnpm db:studio` for Prisma Studio. No `.env.example` file found at project root as of 2026-05-05 (referenced in docs — may need to be created).

**No LICENSE file** in repo root as of 2026-05-05.

**Doc audience:** Self-hosters comfortable with Docker and terminal, not necessarily developers. Tone: direct, practical, no marketing language. No emojis in docs.

**How to apply:** When writing docs for this project, target Docker-familiar self-hosters. Use step-by-step numbered instructions. Always verify paths and commands against actual project files before writing them.

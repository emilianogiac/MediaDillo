# MediaDillo

Self-hosted media library manager for Jellyfin — scan, match, rename, and track your movie and TV collection.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration Reference](#configuration-reference)
- [File Naming Convention](#file-naming-convention)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)
- [Development Setup](#development-setup)

---

## Features

- **Multi-root library scanner** — index movies and TV shows across multiple NAS directories; extracts technical metadata via ffprobe (codec, resolution, bitrate, audio tracks); live progress counter while scanning; partial scan by root or by individual season
- **Existing artwork detection** — automatically detects posters and backdrops already present on disk (Jellyfin standard names and TinyMediaManager suffixes like `-poster`, `-fanart`, `-landscape`)
- **NFO sidecar import** — reads existing Kodi/TMM `.nfo` files during scan to pre-populate metadata without an API call; supports movie, show, and episode-level NFOs
- **TMDB / TVDB metadata matching** — search and match titles against TMDB and TVDB; IMDb → TMDB auto-match via external ID lookup; Italian (or any language) metadata via `METADATA_LANGUAGE` env var
- **Artwork manager** — streams locally saved artwork directly from the NAS; download missing posters and backdrops from TMDB; search and replace artwork per title; Italian-first image sorting (it → en → null); artwork always served fresh (no stale browser cache)
- **Missing content tracker** — episode diff against TMDB for TV shows; movie wishlist for tracking titles you want to acquire
- **File manager** — Jellyfin-standard rename preview and apply; stale file cleanup; per-show Cleanup & Organize panel with rename queue and stale removal; per-movie Folder Cleanup panel (scan folder, remove old TMM artwork and stale NFOs); multi-part episode merge (rename two episodes as part1/part2 + cascade renumber); episode remapper for multi-episode files (`S01E01E02`)
- **Health dashboard** — per-library completeness score; bulk artwork and metadata refresh; duplicate detection (orange badge + tri-state filter); missing-file badge and filter; delete stale records with no files; list view with codec/audio columns, alternating rows, shift-click range selection, and fixed-width columns for consistent alignment
- **Match vs Re-match** — "Match" opens TMDB search (with inline title search input) to assign a new item; "Re-match" silently refreshes metadata using the existing TMDB ID (no modal); artwork downloads automatically on every match/rematch — no second rematch needed; batch Re-match runs as a background job with a persistent progress toast that lists failing items by title
- **Movie edition editor** — inline editor on the movie detail page to set or change the edition label (`{edition-Label}` filename token); displays as a teal badge; shows a `＋ edition` button when unset
- **Folder cleanup** — always-visible panel on movie detail showing all files in the folder; auto-scans on open; pre-selects old TMM artwork, stale NFOs, subtitles, and unknown files for deletion; refreshes after the main folder rescan; **batch cleanup** available in the Movies batch toolbar (amber button) — runs as a background job, applies the same safe-delete logic across all selected movies
- **Toast notifications** — bottom-right toast stack for async action results (match, organize, rename, delete); job toasts show a live progress bar with polling and auto-dismiss 5 s after completion; failing items listed by name (not by opaque ID); skeleton loaders replace the plain "Loading…" text on Movies and Shows pages
- **Scan history** — Dashboard shows the last 10 scans with colour-coded stats (added / changed / removed / stale); most recent scan is highlighted prominently
- **Jellyfin integration** — auto-trigger library refresh after file operations; watched status sync (optional)
- **Export** — JSON, CSV, and NFO sidecar files (Kodi / Jellyfin compatible)
- **Scan scheduler** — configurable scan interval (1h / 6h / 12h / 24h) from the UI

---

## Requirements

- **Docker 24+** and Docker Compose
- A NAS or local media directory mounted and accessible to the container
- **TMDB API key** — free at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
- **TVDB API key** — optional, free at [thetvdb.com](https://thetvdb.com) (used as fallback for edge cases in TV episode numbering)
- **Jellyfin server** — optional; MediaDillo works fully without it
- **ffprobe** — included in the Docker image via ffmpeg; no separate install needed

---

## Installation

### Quick Start (Docker Compose)

**1. Clone the repository.**

```bash
git clone https://github.com/emilianogiac/MediaDillo.git
cd MediaDillo
```

**2. Create your `.env` file from the example.**

```bash
cp .env.example .env
```

**3. Open `.env` and fill in the required values.**

```env
# Required
DB_PASSWORD=changeme           # PostgreSQL password — change this before first run
TMDB_API_KEY=your_key_here     # https://www.themoviedb.org/settings/api

# Scan roots — JSON array of objects with path, label, and type ("movies" or "tv")
SCAN_ROOTS='[
  {"path":"/mnt/nas/film",    "label":"Films",    "type":"movies"},
  {"path":"/mnt/nas/film_4k", "label":"4K Films", "type":"movies"},
  {"path":"/mnt/nas/tv",      "label":"TV Shows", "type":"tv"}
]'

# Optional
TVDB_API_KEY=
JELLYFIN_URL=http://192.168.1.10:8096
JELLYFIN_API_KEY=
```

> **Note:** `DATABASE_URL` is set automatically by `docker-compose.yml` using `DB_PASSWORD`. You do not need to set it manually.

**4. Adjust the volume mount in `docker-compose.yml` if your NAS path differs from `/mnt/nas`.**

Open `docker-compose.yml` and find this line under the `app` service:

```yaml
volumes:
  - /mnt/nas:/mnt/nas:rw
```

Replace `/mnt/nas` (left side) with the actual path on your host machine where the media is located. Leave the right side and `:rw` as-is.

**5. Start the stack.**

```bash
docker compose up -d
```

**6. Open the app.**

Go to [http://localhost:7731](http://localhost:7731) in your browser.

**7. Verify your scan roots and run your first scan.**

Navigate to **Settings → Scan Roots** to confirm your configured roots are listed. Then go to the **Dashboard** and trigger your first scan.

---

## Configuration Reference

All configuration is via environment variables in your `.env` file.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_PASSWORD` | Yes | `changeme` | PostgreSQL password. Change before first run. |
| `DATABASE_URL` | Auto | set by Compose | Full Postgres connection string. Set automatically by `docker-compose.yml` — do not override unless running outside Docker. |
| `TMDB_API_KEY` | Yes | — | TMDB v3 API key for metadata and artwork lookups. Use the **API Key (v3 auth)** from TMDB settings, not the read access token. |
| `TVDB_API_KEY` | No | — | TVDB API key. Fallback for TV episode numbering edge cases. |
| `SCAN_ROOTS` | Yes | `[]` | JSON array of scan root objects: `{"path": "...", "label": "...", "type": "movies" \| "tv"}` |
| `JELLYFIN_URL` | No | — | Base URL of your Jellyfin server, e.g. `http://192.168.1.10:8096` |
| `JELLYFIN_API_KEY` | No | — | Jellyfin API key. Generate from Jellyfin: **Dashboard → Advanced → API Keys → +** |
| `PORT` | No | `7731` | Port the API and frontend are served on inside the container. |
| `NODE_ENV` | No | `production` | Set to `development` for verbose logging. |

---

## File Naming Convention

MediaDillo enforces the **Jellyfin standard** naming convention so your files are auto-detected by Jellyfin without manual intervention.

### Movies

```
/mnt/nas/film/
  Movie Title (Year)/
    Movie Title (Year).mkv
    poster.jpg
    backdrop.jpg
    movie.nfo          ← optional NFO sidecar
```

### TV Shows

```
/mnt/nas/tv/
  Show Name (Year)/
    Season 01/
      Show Name - S01E01 - Episode Title.mkv
    Season 02/
      ...
```

### Multi-disc movies

```
Movie Title (Year)/
  Movie Title (Year) - cd1.mkv   ← both map to one Movie record
  Movie Title (Year) - cd2.mkv
```

Recognised suffixes: `-cd1`/`-cd2`, `-disc1`/`-disc2`, `-part1`/`-part2`, `-pt1`/`-pt2`.

### Two-part TV episodes

```
Season 01/
  Show Name - S01E05 - Title - part1.mkv   ← both linked to Episode E05
  Show Name - S01E05 - Title - part2.mkv
```

Use **Merge Multi-Part Episodes** on the season detail page to convert two separate episode records into one, then renumber all following episodes.

### Rules

- Title case; only `()`, `-`, and spaces are allowed in file and folder names
- Year is always the 4-digit release year in parentheses; bare year in TV filenames (e.g. `Show.Name.2005.S01E01`) is also recognised
- Multi-episode single-file: `S01E01E02` (one file covering two episodes)
- Both `S01E01` and `01x01` episode naming conventions are recognised during scanning
- Optional quality suffix: `Show Name - S01E01 - Episode Title [1080p].mkv`
- All renames are **preview-only** until you explicitly apply them — no files are moved or renamed without your confirmation

---

## Updating

```bash
git pull
docker compose build --no-cache
docker compose up -d
```

Database schema is managed by Prisma. Schema changes applied during startup are non-destructive by default — your data is preserved.

---

## Troubleshooting

### Container fails to start / exits immediately

Check the logs first:

```bash
docker compose logs app
```

Common causes:

- **Invalid `SCAN_ROOTS` JSON** — this is the most frequent cause. Validate your value:
  ```bash
  echo $SCAN_ROOTS | python3 -m json.tool
  ```
- **Missing `DB_PASSWORD`** — the app will refuse to start if required env vars are absent.

---

### Database connection refused

The `app` container waits for `db` to pass its healthcheck before starting. If Postgres is slow to initialize (first boot), wait 10–15 seconds, then:

```bash
docker compose restart app
```

Check db logs if the problem persists:

```bash
docker compose logs db
```

---

### Scan finds no files

1. Confirm the volume mount in `docker-compose.yml` matches your NAS host path.
2. Verify the paths are accessible inside the container:
   ```bash
   docker compose exec app ls /mnt/nas/film
   ```
3. Check that each scan root in `SCAN_ROOTS` has the correct `path` value matching the container-side mount path.

---

### TMDB metadata not fetching / 401 errors

Verify your key is valid by testing it directly:

```
https://api.themoviedb.org/3/configuration?api_key=YOUR_KEY
```

Use the **API Key (v3 auth)** from your TMDB account settings — not the "Read Access Token." These are different values on the TMDB settings page.

---

### Jellyfin integration not working

The Jellyfin integration is optional. MediaDillo works fully without it.

If you have it configured and it is not working:

1. Confirm `JELLYFIN_URL` is reachable from inside the container:
   ```bash
   docker compose exec app wget -qO- http://your-jellyfin:8096/health
   ```
2. Confirm your API key is correct. Generate one from Jellyfin: **Dashboard → Advanced → API Keys → +**
3. Go to **Settings → Jellyfin** in the app — the connection status is shown on page load.

---

### Port 7731 already in use

Change the host-side port in `docker-compose.yml`:

```yaml
ports:
  - "7732:7731"   # host:container — change the left number only
```

Leave the `PORT` env var and the container-side port as `7731` unless you also update the `EXPOSE` instruction in the Dockerfile.

---

### Artwork not downloading

MediaDillo writes artwork to `{scan_root_path}/{item_folder}/poster.jpg`. For this to work, the container needs write access to the NAS mount.

Check your volume in `docker-compose.yml` is mounted read-write:

```yaml
volumes:
  - /mnt/nas:/mnt/nas:rw    # must be :rw, not :ro
```

---

### Stale / leftover files from TinyMediaManager

Open **File Manager → Stale Files** to review leftover `.tbn`, `.xml`, and TMM metadata files. Preview the list before taking any action — you can either delete them or mark them as ignored ("resolve") without deletion.

---

### UI shows blank or "Something went wrong"

1. Open your browser's developer tools and go to the **Network** tab to see which API call failed.
2. Check the backend logs for the corresponding error:
   ```bash
   docker compose logs app --tail=50
   ```

---

### Resetting the database

This deletes all indexed data and cannot be undone.

```bash
docker compose down -v   # removes the pgdata volume — ALL data is lost
docker compose up -d
```

---

## Development Setup

For contributors or local development without Docker.

**Prerequisites:** Node.js 20, pnpm, PostgreSQL running locally.

**1. Install dependencies.**

```bash
pnpm install
```

**2. Configure the API environment.**

Create a `.env` file inside `apps/api/` with a `DATABASE_URL` pointing to your local Postgres instance, plus your `TMDB_API_KEY` and other variables from the [Configuration Reference](#configuration-reference).

**3. Push the database schema.**

```bash
pnpm db:push
```

**4. Start the dev servers.**

The API runs on `:7731` and the Vite dev server with HMR runs on `:5173`.

```bash
pnpm dev
```

**5. Run the test suite.**

```bash
pnpm test
```

**6. Typecheck all packages.**

```bash
pnpm -r typecheck
```

---

## Project Structure

```
MediaDillo/
├── apps/
│   ├── api/          # Fastify backend (Node.js + TypeScript)
│   └── web/          # React + Tailwind frontend (Vite)
├── packages/
│   └── db/           # Prisma schema and database client (@mediadillo/db)
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

---

## License

MIT

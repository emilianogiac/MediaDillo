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
- **TMDB / TVDB metadata matching** — TMDB for movies and show-level metadata (artwork, overview, credits); TVDB for TV episode titles and air dates (more accurate numbering); TVDB ID resolved automatically via TMDB external_ids on first enrich — no separate match step needed; IMDb → TMDB auto-match via external ID lookup; Italian (or any language) metadata via `METADATA_LANGUAGE` env var; graceful per-season fallback to TMDB if TVDB is unavailable; **per-show TVDB episode ordering** — dropdown on the show detail page shows only the orderings TVDB actually provides for that series (Aired, DVD, Absolute); selecting one saves it and re-enriches episodes; Absolute ordering (important for anime) fetches all episodes flat without season filtering; ordering dropdown is hidden if TVDB only offers one ordering; **TVDB-only shows** — the Match modal on show detail pages includes a TVDB tab for shows not available on TMDB; search TVDB by title or enter a TVDB ID directly; matched shows are marked with a "TVDB only" badge and refresh entirely from TVDB (title, overview, year, poster, episodes) on subsequent Re-match calls; movies always use TMDB only
- **Artwork manager** — streams locally saved artwork directly from the NAS; download missing posters and backdrops from TMDB; search and replace artwork per title; Italian-first image sorting (it → en → null); artwork always served fresh (no stale browser cache)
- **Missing content tracker** — episode diff against TMDB for TV shows; movie wishlist for tracking titles you want to acquire
- **File manager** — Jellyfin-standard rename preview and apply; stale file cleanup; per-show Cleanup & Organize panel with rename queue and stale removal; per-movie Folder Cleanup panel (scan folder, remove old TMM artwork and stale NFOs); multi-part episode merge (rename two episodes as part1/part2 + cascade renumber); episode remapper for multi-episode files (`S01E01E02`); **episode rename at three granularities** — "Rename all episodes" on the show detail page, season-level rename panel on the season detail page, and per-episode inline rename on each episode row; **show/season rescan** — rescan button on show detail page rescans all seasons, season detail page rescans individual season; both show a live spinner during the scan and a detailed result panel (files found, added/changed/removed counts, skipped files with reason) or an error if the folder isn't found; **progress indicators** — spinner shown inline during rescan, rename, and rematch operations on show and season detail pages; errors displayed inline with retry where applicable; **specials (Season 0)** — `S00E01` files are scanned and stored as Season 0; on enrich/rematch, Season 0 episode titles and air dates are fetched for specials you own (missing specials are never created); Season 0 displays as "Specials" in the show detail season grid and season detail page; **episode reorder panel** — drag-and-drop panel on the season detail page to fix mislabeled episodes; TMDB/TVDB titles are fixed on the left, filenames are draggable on the right; missing episodes shown as placeholders so you can reassign a mislabeled file to its correct slot; applies a two-phase rename (tmp → final) to avoid circular collisions; empty subdirectories are removed after cleanup operations; **Cleanup Show button** — one-click button on the show detail page (between "Rename all episodes" and "Rescan") that auto-trashes all stale and orphaned files across the entire show folder without opening the Cleanup & Organize panel; **multi-part episode rename** — renumber and reorder operations correctly handle episodes stored as multiple files (`part1`/`part2`/…), assigning stable part numbers sorted by path so all N files get distinct canonical names; rename preview and apply now use the same file ordering so `needsRename` is accurate for split episodes; organize panel renames and trashes in a single "Apply selected" click even when the show folder itself is also being renamed
- **Health dashboard** — per-library completeness score; bulk artwork and metadata refresh; duplicate detection (orange badge + tri-state filter); missing-file badge and filter; delete stale records with no files; list view with codec/audio columns, alternating rows, shift-click range selection, and fixed-width columns for consistent alignment; **batch remove records** available in the Movies and Shows list view batch toolbar — select multiple items and remove all DB entries at once with a single confirmation dialog
- **Movies list — sort & filter** — sortable by title, year, rating, or quality; sort and view (grid/list) persist in URL; active filters shown as dismissible chips above the grid; each toggle filter shows a live count badge when inactive; scan root dropdown collapses to a `<select>` when more than 4 roots are configured; contextual empty state messages per active filter
- **TV Shows list — sort & filter** — full filter parity with movies: library selector (scan root tabs/dropdown), genre picker (client-side), sort by title, year, rating, or episode completeness, quality tier filter, Airing/Ended status toggles, New badge and filter, Missing artwork, Unmatched, Needs organizing, and Duplicates filters; active filters shown as dismissible chips; grid and list views with completeness bar; **batch actions in list view** — Rematch, Rename all (background job), Cleanup (removes stale-extension files from show folders), and Remove records; completeness bar colors (green = 100%, blue ≥ 80%, yellow ≥ 50%, red < 50%); **multi-library split** — shows belonging to more than one scan root appear as a separate row per library so each instance is visible and independently selectable; **list view details** — each row shows the library label and an "⚠ Organize" badge when the folder needs renaming; **deselect on filter** — selected items that are filtered out of the visible list are automatically deselected; **Watch in Jellyfin ↗** deep-link button on show detail page header (mirrors movie behaviour); show detail header displays the library badge(s) the show belongs to
- **Keyboard shortcuts** — press `?` in the movies list to see all shortcuts: `g`/`l` toggle grid/list, `/` focuses search, `Escape` clears filters
- **Match vs Re-match** — "Match" opens a search modal to assign a new item; for shows the modal has TMDB and TVDB tabs (switch to TVDB for shows not on TMDB); "Re-match" silently re-enriches using the existing match — TMDB+TVDB for standard shows, TVDB-only for shows matched via the TVDB tab; artwork downloads automatically on every match/rematch; batch Re-match runs as a background job with a persistent progress toast that lists failing items by title; **attention indicators** — a green dot appears on action buttons ("Rename all episodes", "Cleanup Show") when there is pending work; movie detail section headings ("Rename & Organize", "Folder cleanup") show the same dot; a "✓ Organized" badge appears in the title area when no pending renames or removals exist; after "Cleanup Show" completes the Cleanup & Organize card below refreshes automatically
- **Movie edition editor** — picker panel to set/change the edition label (`{edition-Label}` filename token); existing editions shown as chips for reuse; global rename renames that edition across all movies and renames files on disk; leading dots stripped from titles in all canonical filenames; **edition filter pills** on /movies filter bar let you narrow the list to a specific edition
- **Folder cleanup** — always-visible panel on movie detail showing all files in the folder; auto-scans on open; TMM-named artwork (`Title-poster.jpg`) pre-selected for deletion when a canonical counterpart (`poster.jpg`/`backdrop.jpg`) already exists in the same folder (without a canonical the TMM file is preserved); only exact canonical names are fully protected; sibling edition files in the same folder are never flagged; **batch cleanup** available in the Movies batch toolbar (amber button); **show Cleanup & Organize panel** — episode-file renames only (show-folder renames excluded); stale file removal uses same canonical-awareness logic as movie cleanup
- **Batch Rename All** — runs as a background job with a live progress toast ("Renaming N movies"); errors listed by movie title; **Apply All Remaining** button in the step-through modal skips directly to a background batch for all pending movies
- **Rename undo** — rename history shown on movie detail with a Revert button per entry; swaps file back to its previous name and updates the database record
- **Drag-and-drop file ordering** — multi-file movies use a grip handle to drag files into the desired sort order; save button persists the new order
- **Delete movie from disk** — "Delete from disk" button on movie detail page opens a confirmation modal listing every file and size in the folder; permanently deletes all files, removes the empty folder, and triggers a Jellyfin library refresh
- **Duplicate resolution** — when a TMDB ID is shared by multiple records, a highlighted panel on the movie detail page shows all sibling records with collection label, folder path, and filename; per-sibling actions: **Consolidate** (move sibling files into current folder), **Replace** (swap current files with sibling's), **Delete** (remove sibling and files from disk), **Browse** (navigate to sibling detail); **Dismiss** marks a pair as intentional so it's hidden from duplicate filters; dismissed copies shown in a muted section with Undo; cross-filesystem moves handled transparently
- **Multi-edition rename fix** — Rename & Organize correctly handles multi-edition movies (e.g. Theatrical + Director's Cut); part numbers are only assigned within edition groups that have more than one file; the "needs organization" check uses the same per-edition-group logic so correctly renamed multi-edition movies are no longer flagged; edition-less files no longer show a spurious "part X" label in the Files section of the detail page
- **Per-file delete** — on multi-edition movies, each file card shows an individual "Delete from disk" button; the parent folder is automatically removed if it is empty after the deletion
- **New items after scan** — a sky-blue **"New"** badge appears on every poster card and list row (Movies and TV Shows) for items discovered in the most recent scan; a **✦ New** filter chip in each filter bar narrows the list to those items for quick review and organization; clicking × on the chip clears the highlight; composable with all other filters (e.g. New + Needs organizing)
- **Inline metadata editing** — hover any of title, year, tagline, or overview on the detail page to reveal a pencil icon; click to edit inline and save to the database; hover artwork card poster to reveal a "Get Art" quick-action button; **TMDB/TVDB/IMDb IDs** shown below genres and before the description on both movie and show detail pages
- **Auto-cleanup on match** — optional setting (Settings → Match Behavior) to automatically delete stale TMM artwork, extra NFOs, subtitles and unknown files after every match or re-match
- **Toast notifications** — bottom-right toast stack for async action results; job toasts show a live progress bar with polling and auto-dismiss 5 s after completion; failing items listed by name; **"Only show selected"** toggle chip in the batch action bar (both Movies and Shows list view) filters the list to only the selected rows; **no-scroll batch reload** — refreshing the list after a batch action no longer scrolls the page back to the top
- **Scan history** — Dashboard shows the last 10 scans with colour-coded stats (added / changed / removed / stale); **scan progress persists across navigation** — returning to the Dashboard while a scan is in progress resumes the live progress display automatically; if the scan button is clicked while a scan is already running the UI silently reconnects to the existing scan instead of showing an error
- **Editable API keys** — TMDB, TVDB, Jellyfin URL/key, and metadata language are configurable from Settings → API Keys in the UI; values are validated against their respective APIs before saving; env var values are seeded on first start and continue working as fallbacks
- **Jellyfin integration** — auto-trigger library refresh after file operations; watched status sync; **Watch in Jellyfin ↗** deep-link on every matched movie detail page (instant after first sync via stored `jellyfinId`); Jellyfin ID sync no longer incorrectly stamps the same ID onto multiple records sharing a TMDB ID (multi-edition libraries)
- **Export** — JSON, CSV, and NFO sidecar files (Kodi / Jellyfin compatible)
- **Scan scheduler** — configurable scan interval (1h / 6h / 12h / 24h) from the UI

---

## Requirements

- **Docker 24+** and Docker Compose
- A NAS or local media directory mounted and accessible to the container
- **TMDB API key** — free at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
- **TVDB API key** — recommended for TV shows, free at [thetvdb.com](https://thetvdb.com); used for episode titles and numbering (more accurate than TMDB for many shows); falls back to TMDB if not configured
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
| `TMDB_API_KEY` | Yes* | — | TMDB v3 API key for metadata and artwork lookups. Use the **API Key (v3 auth)** from TMDB settings, not the read access token. *Can also be set via Settings → API Keys in the UI. |
| `TVDB_API_KEY` | No | — | TVDB API key. Fallback for TV episode numbering edge cases. Can also be set via Settings → API Keys. |
| `SCAN_ROOTS` | Yes | `[]` | JSON array of scan root objects: `{"path": "...", "label": "...", "type": "movies" \| "tv"}` |
| `JELLYFIN_URL` | No | — | Base URL of your Jellyfin server, e.g. `http://192.168.1.10:8096`. Can also be set via Settings → API Keys. |
| `JELLYFIN_API_KEY` | No | — | Jellyfin API key. Generate from Jellyfin: **Dashboard → Advanced → API Keys → +**. Can also be set via Settings → API Keys. |
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

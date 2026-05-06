# MediaDillo — Product Spec

## Context

Replacing TinyMediaManager on a Linux VM running Jellyfin. The goal is a self-hosted WebUI app that tracks a large media collection (1000+ movies, 100+ TV shows) on a NAS, manages files according to a consistent naming convention, surfaces missing content, and keeps Jellyfin in sync. Must be Docker-native, LAN-accessible, lightweight, and exportable.

---

## App Name

**MediaDillo**

---

## Architecture

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React + TypeScript + Tailwind + Vite | Project standard |
| Backend | Node.js + Fastify + TypeScript | Fast, schema-first, project standard |
| Database | PostgreSQL + Prisma | Relational (episodes, seasons, cast — many-to-many) |
| Deployment | Docker Compose | VM-native, alongside Jellyfin |
| Metadata | TMDB API + TVDB API | Free, comprehensive, Jellyfin-compatible |

Database is source of truth. NAS is file store. TMDB/TVDB are read-only enrichment sources.

---

## File Naming Convention

Adopted: **Jellyfin standard** (industry default, ensures Jellyfin auto-picks up files without manual intervention).

### Movies
```
{CATEGORY_PATH}/                      ← e.g. /mnt/nas/film, /mnt/nas/film_4k, /mnt/nas/cartoni
  Movie Title (Year)/
    Movie Title (Year).mkv            ← main file
    Movie Title (Year)-trailer.mp4    ← optional
    poster.jpg
    backdrop.jpg
    movie.nfo                         ← optional NFO (Jellyfin sidecar)
```

### TV Shows
```
{TV_PATH}/
  Show Name (Year)/
    poster.jpg
    backdrop.jpg
    Season 01/
      Show Name - S01E01 - Episode Title.mkv
      Show Name - S01E02 - Episode Title.mkv
    Season 02/
      ...
```

### Multi-disc / multi-part movies

```
Movie Title (Year)/
  Movie Title (Year) - cd1.mkv    ← both files map to the same Movie record
  Movie Title (Year) - cd2.mkv
```

Recognised suffixes: `-cd1`/`-cd2`, `-disc1`/`-disc2`, `-part1`/`-part2`, `-pt1`/`-pt2`. The suffix is stripped before title/year extraction so both files deduplicate correctly.

### Two-part TV episodes

```
Season 01/
  Show Name - S01E05 - Title - part1.mkv   ← both files linked to Episode E05
  Show Name - S01E05 - Title - part2.mkv
```

Use the **Merge Multi-Part Episodes** panel on any season detail page to convert two separate episode records into a single episode with two files, then optionally renumber all following episodes down by one.

### Rules
- Title case, no special characters except `()`, `-`, spaces
- Year is always 4-digit release year in parentheses; bare year in TV filenames (`Show.Name.2005.S01E01`) is also recognised and stripped from the title before deduplication
- Multi-episode single-file: `S01E01E02` (`EpisodeFile.multiEpisodeEnd` tracks the end number)
- Multi-file per-episode (two-parter): `S01E05 - part1` / `S01E05 - part2` — both files link to the same Episode record
- Quality tag optional suffix: `Show Name - S01E01 - Title [1080p].mkv`
- All renames preview before apply — no destructive ops without confirmation
- **Sidecar files** (poster.jpg, backdrop.jpg, movie.nfo, *.srt, *.sub, TMM artwork suffixes) migrate automatically when a movie or show folder is renamed; unknown files are left in place and surfaced in Stale Files

---

## Core Modules

### 1. Library Scanner
- Multiple configurable scan roots with category labels
- Each root has a `type` (movies or tv) and a `label` (e.g. "4K Films", "Cartoons")
- Recursively walks each root, detects video files by extension (`.mkv`, `.mp4`, `.avi`, `.m4v`, etc.)
- Parses filename to extract title + year (movies) or show + S/E (TV); supports both `S01E01` and `01x01` episode naming conventions
- Scan root `type` (`movies` | `tv`) is ground truth for routing files — not filename parser alone
- Matches to TMDB/TVDB entry (confidence score, manual fallback)
- Extracts technical metadata via **ffprobe**:
  - Video: codec (H.264, H.265/HEVC, AV1, etc.), resolution/quality tier (SD/720p/1080p/4K), HDR flag
  - Audio: codec (AAC, AC3, DTS, TrueHD, etc.), quality tier, channel layout (2.0, 5.1, 7.1, Atmos)
- **Existing artwork detection**: detects posters and backdrops already on disk — Jellyfin standard names (`poster.jpg`, `backdrop.jpg`, `fanart.jpg`, `folder.jpg`) and TinyMediaManager suffixes (`-poster`, `-fanart`, `-landscape`, `-background`, etc.)
- **NFO sidecar import**: reads existing Kodi/TMM `.nfo` XML files during scan to pre-populate title, year, TMDB/IMDB IDs, overview, genres, cast, and directors without an API call
- **Live scan progress**: `GET /api/scan/progress` exposes files found / processed / current file; dashboard polls every 2s while scanning
- Incremental scan: only processes new/changed files (mtime tracking)
- **Completeness check**: flags items missing poster, backdrop, metadata fields, or matched TMDB ID

### 2. Metadata Engine
- **Movies**: TMDB API → title, year, genres, runtime, rating, overview, tagline, cast, director, poster, backdrop, IMDb ID
- **TV Shows**: TMDB API → series metadata, seasons list, episode list; TVDB as fallback for episode numbering edge cases
- **IMDb**: Cross-referenced via TMDB's `imdb_id` field — no separate API key needed
- **IMDb → TMDB auto-match**: if a movie has an IMDb ID (e.g. from NFO import) but no TMDB ID, the metadata scan uses `GET /find/{imdbId}?external_source=imdb_id` to resolve it directly without a title search
- **Language**: `METADATA_LANGUAGE` env var (default `it-IT`) controls the language of all TMDB fetches — title, overview, tagline, episode names are returned in the configured language with automatic English fallback
- **External links**: TMDB, IMDb, and TVDB links displayed as clickable pills on movie and show detail pages
- Metadata stored locally in PostgreSQL — never re-fetched unless user triggers refresh
- Manual override fields for any metadata value
- **Artwork management**:
  - Artwork stored as URLs (lazy-loaded) by default
  - Download option: fetches and saves to `{SCAN_ROOT}/{item_folder}/` (poster.jpg, backdrop.jpg)
  - **Local artwork serving**: `GET /api/artwork/movies/:id/poster|backdrop` and `GET /api/artwork/shows/:id/poster|backdrop` stream files directly from the NAS — the UI uses local endpoints when `posterDownloaded=true`
  - Artwork search: for any item with missing art, query TMDB image API and let user pick from results
  - Missing art highlighted with warning badge; accessible from `/health` and item detail

### 3. Missing Content Tracker
- For each TV show: compare owned episodes vs full episode list from TMDB
- Episode status: `owned` | `missing` | `not_yet_aired` | `ignored`
- UI: season-by-season grid showing episode status
- Aggregate view: shows sorted by "% complete" or "episodes missing"
- Movie wishlist: `wanted` status for movies not yet owned

### 4. File Manager
- Rename files/folders to match naming convention
- Show current name → proposed name diff before applying
- Batch rename (whole library or selection)
- **Sidecar migration**: when a movie folder is renamed, all known sidecars (poster/backdrop/NFO/subtitles/TMM artwork suffixes) are moved to the new folder; old folder removed if empty
- **Show folder rename**: TV show directories renamed to canonical name; all EpisodeFile paths updated in DB atomically; season folders move automatically (they're inside the show folder)
- Move files between category roots
- Recycle bin pattern for deletions (move to `.trash/`, never `rm`)
- **Stale file cleanup**: surface leftover `.tbn`, `.xml`, old TMM metadata files, duplicate artwork for review and optional deletion
- **Multi-part merger**: detects movies split across two files (`-cd1`/`-cd2`, `-part1`/`-part2`, `-disk1`/`-disk2`); ffmpeg concat merges them into one canonical file; originals moved to `.trash/`
- **Episode remapper**: reassign any episode file to a different season/episode number; supports multi-episode files (e.g. `S01E01E02`); rename preview reflects the new mapping
- **Show Cleanup & Organize panel**: per-show collapsible panel on the show detail page — rename queue (preview + per-item select + apply) + stale file removal queue with individual or bulk apply
- **Season rescan**: scoped single-folder scan triggered from the season detail page; runs synchronously and returns added/changed/removed counts; does not block full scans
- **Multi-part episode merge + renumber**: MergePartsPanel on season detail — pick two episode numbers, rename them as part1/part2 of the primary episode number, re-parent both files in DB, optionally cascade renumber all following episodes down by 1
- Post-operation: automatically triggers Jellyfin library scan

### 5. Jellyfin Integration
- Config: `JELLYFIN_URL` + `JELLYFIN_API_KEY` env vars
- After file operations: POST to Jellyfin `/Library/Refresh`
- Optionally: fetch watch status to show "watched" badges
- Optional — app works fully without Jellyfin configured

### 6. Health & Completeness Dashboard
- Per-item completeness: poster, backdrop, metadata complete, TMDB matched, has files
- Filter by: missing poster | missing backdrop | unmatched | no files | incomplete metadata
- Bulk actions: download missing artwork, re-scan metadata
- **Duplicate detection**: movies and shows sharing a `tmdbId` are tagged with an orange "Duplicate" badge; tri-state filter (all / only / hide) on browse pages; `tmdbId` is intentionally non-unique to support multi-edition and split-file libraries
- **Missing file badge**: red "Missing file" badge on any item with no video files attached; filterable on /movies; detail page shows delete option for stale records
- **DB maintenance** (Settings): "Verify library integrity" removes ghost records and resets orphaned episodes; "Merge duplicate TV shows" consolidates phantom TvShow records caused by inconsistent filename parsing

---

## UI Structure

```
/                    → Dashboard (library stats, recent additions, health summary)
/movies              → Movie library grid (filterable by category/genre/quality/health)
/movies/:id          → Movie detail (metadata, files with tech specs, artwork manager)
/shows               → TV library grid
/shows/:id           → Show detail with season/episode breakdown + missing tracker
/shows/:id/season/:n → Season detail with episode list and file tech specs
/missing             → Aggregated missing content (shows + movies wanted)
/health              → Library health: items missing art, metadata, unmatched files
/files               → File manager (browse by root, rename queue, stale cleanup, scan trigger)
/settings            → Scan roots, API keys, Jellyfin config
```

### UI Principles
- Poster-forward design (dark mode default)
- Responsive but desktop-primary
- Virtual scroll for large lists
- Warning badges on cards for items with missing data

---

## Data Model

```
ScanRoot       { id, path, label, type: movies|tv, enabled }

Movie          { id, tmdb_id, imdb_id, title, year, genres[], runtime, rating, overview,
                 poster_url, backdrop_url, poster_downloaded, backdrop_downloaded,
                 status: owned|wanted, scan_root_id }
MovieFile      { id, movie_id, path, size_bytes, duration_s,
                 video_codec, video_resolution, video_quality_tier, hdr,
                 audio_codec, audio_channels, audio_quality_tier, scanned_at }

TvShow         { id, tmdb_id, tvdb_id, title, year, status: continuing|ended,
                 total_episodes, owned_episodes,
                 poster_url, backdrop_url, poster_downloaded, backdrop_downloaded }
Season         { id, show_id, season_number, episode_count }
Episode        { id, season_id, episode_number, title, air_date,
                 status: owned|missing|not_yet_aired|ignored }
EpisodeFile    { id, episode_id, path, size_bytes,
                 video_codec, video_resolution, video_quality_tier, hdr,
                 audio_codec, audio_channels, audio_quality_tier,
                 multi_episode_end, scanned_at }

Person         { id, tmdb_id, name, profile_url }
Credit         { id, person_id, media_type, media_id, role: cast|director|writer, character }

ScanLog        { id, started_at, finished_at, roots_scanned[],
                 files_added, files_changed, files_removed, stale_files_found }
StaleFile      { id, path, scan_log_id, reason, resolved }
```

---

## Configuration

```env
# Scan roots — JSON array of {path, label, type}
SCAN_ROOTS='[
  {"path":"/mnt/nas/film",     "label":"Films",    "type":"movies"},
  {"path":"/mnt/nas/film_4k",  "label":"4K Films", "type":"movies"},
  {"path":"/mnt/nas/film_3d",  "label":"3D Films", "type":"movies"},
  {"path":"/mnt/nas/cartoni",  "label":"Cartoons", "type":"movies"},
  {"path":"/mnt/nas/tv",       "label":"TV Shows", "type":"tv"}
]'

TMDB_API_KEY=
TVDB_API_KEY=
METADATA_LANGUAGE=it-IT  # TMDB fetch language; title + overview in this language, falls back to English

# Optional
JELLYFIN_URL=http://localhost:8096
JELLYFIN_API_KEY=

DATABASE_URL=postgresql://mediadillo:...@db:5432/mediadillo
PORT=7731
```

---

## Docker Compose

```yaml
services:
  app:
    build: .
    ports: ["7731:7731"]
    volumes:
      - /mnt/nas:/mnt/nas:rw
    env_file: .env
    depends_on: [db]

  db:
    image: postgres:16-alpine
    ports: ["7732:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: mediadillo
      POSTGRES_USER: mediadillo
      POSTGRES_PASSWORD: ${DB_PASSWORD}

volumes:
  pgdata:
```

---

## Export / Portability
- Full DB export as JSON or CSV from `/settings`
- Optional NFO sidecar files (Kodi/Jellyfin standard) written alongside media
- Prisma migrations versioned — schema changes are never destructive by default

---

## Out of Scope (v1)
- Torrent/download client integration
- Transcoding or streaming
- Mobile app
- Multi-user permissions
- Internet-facing deployment / HTTPS
- Music or photo libraries

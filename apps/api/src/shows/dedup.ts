/**
 * Duplicate-show detection and merge planning (issue #118).
 *
 * The original implementation grouped shows by lowercased title alone, so a
 * reboot sharing its parent's title — MacGyver 1985 vs MacGyver 2016 — was
 * treated as a duplicate and merged, hard-deleting episode rows and reattaching
 * files to the wrong series. Provider ids are the only trustworthy identity, and
 * even a shared id does not license a destructive merge: a library may hold the
 * same series twice on purpose (an Italian and an English M.A.S.K.).
 *
 * The planner is pure so the rules can be tested without a database, and it
 * upholds one invariant: **an episode row is never deleted.** Anything that
 * would require deleting one is reported as a conflict for a human to settle.
 */

export interface DedupEpisode {
  id: string
  episodeNumber: number
  fileCount: number
}

export interface DedupSeason {
  id: string
  seasonNumber: number
  episodes: DedupEpisode[]
}

export interface DedupShow {
  id: string
  title: string
  year: number | null
  tmdbId: number | null
  tvdbId: number | null
  createdAt: Date
  seasons: DedupSeason[]
}

export interface PlannedMerge {
  key: string
  title: string
  canonicalId: string
  duplicateId: string
  /** Seasons with no counterpart in the canonical show: re-parent wholesale. */
  seasonsToReparent: string[]
  /** Episodes whose season exists in the canonical show: re-parent individually. */
  episodesToReparent: { episodeId: string; targetSeasonNumber: number }[]
  /** Season rows left empty by the move; deleting them loses no episode or file. */
  seasonsToDelete: string[]
}

export interface DedupConflict {
  key: string
  title: string
  canonicalId: string
  duplicateId: string
  reason: 'episode-collision'
  /** The slots held by both records — merging would have deleted these rows. */
  collisions: { seasonNumber: number; episodeNumber: number }[]
}

export interface DedupPlan {
  merges: PlannedMerge[]
  conflicts: DedupConflict[]
}

/**
 * Identity for grouping. A provider id is authoritative when present; title and
 * year are a fallback for records that have never been matched. Two shows whose
 * provider ids disagree are different series and can never share a key.
 */
export function identityKey(show: DedupShow): string {
  if (show.tvdbId !== null) return `tvdb:${show.tvdbId}`
  if (show.tmdbId !== null) return `tmdb:${show.tmdbId}`
  return `title:${show.title.toLowerCase().trim()}|${show.year ?? ''}`
}

function fileCount(show: DedupShow): number {
  return show.seasons.reduce(
    (sum, s) => sum + s.episodes.reduce((n, e) => n + e.fileCount, 0),
    0,
  )
}

function episodeCount(show: DedupShow): number {
  return show.seasons.reduce((sum, s) => sum + s.episodes.length, 0)
}

/**
 * The record that survives: the one holding the most files, then the most
 * episodes, then the oldest. Every tiebreaker is explicit — the previous
 * implementation scored candidates so coarsely that real cases tied at the top
 * and the winner fell out of V8's sort stability.
 */
function pickCanonical(group: DedupShow[]): DedupShow {
  return [...group].sort(
    (a, b) =>
      fileCount(b) - fileCount(a) ||
      episodeCount(b) - episodeCount(a) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  )[0]!
}

function occupiedSlots(show: DedupShow): Set<string> {
  const slots = new Set<string>()
  for (const season of show.seasons) {
    for (const episode of season.episodes) {
      slots.add(`${season.seasonNumber}:${episode.episodeNumber}`)
    }
  }
  return slots
}

function planOne(
  canonical: DedupShow,
  duplicate: DedupShow,
  key: string,
): PlannedMerge | DedupConflict {
  const taken = occupiedSlots(canonical)
  const collisions = duplicate.seasons.flatMap((season) =>
    season.episodes
      .filter((e) => taken.has(`${season.seasonNumber}:${e.episodeNumber}`))
      .map((e) => ({ seasonNumber: season.seasonNumber, episodeNumber: e.episodeNumber })),
  )
  if (collisions.length > 0) {
    return {
      key,
      title: duplicate.title,
      canonicalId: canonical.id,
      duplicateId: duplicate.id,
      reason: 'episode-collision',
      collisions,
    }
  }

  const canonicalSeasons = new Set(canonical.seasons.map((s) => s.seasonNumber))
  const merge: PlannedMerge = {
    key,
    title: duplicate.title,
    canonicalId: canonical.id,
    duplicateId: duplicate.id,
    seasonsToReparent: [],
    episodesToReparent: [],
    seasonsToDelete: [],
  }
  for (const season of duplicate.seasons) {
    if (!canonicalSeasons.has(season.seasonNumber)) {
      merge.seasonsToReparent.push(season.id)
      continue
    }
    for (const episode of season.episodes) {
      merge.episodesToReparent.push({
        episodeId: episode.id,
        targetSeasonNumber: season.seasonNumber,
      })
    }
    merge.seasonsToDelete.push(season.id)
  }
  return merge
}

function isConflict(r: PlannedMerge | DedupConflict): r is DedupConflict {
  return 'reason' in r
}

/** Group by identity, then plan each group. Never deletes an episode row. */
export function planDedup(shows: DedupShow[]): DedupPlan {
  const groups = new Map<string, DedupShow[]>()
  for (const show of shows) {
    const key = identityKey(show)
    groups.set(key, [...(groups.get(key) ?? []), show])
  }

  const plan: DedupPlan = { merges: [], conflicts: [] }
  for (const [key, group] of groups) {
    if (group.length < 2) continue
    const canonical = pickCanonical(group)
    for (const duplicate of group) {
      if (duplicate.id === canonical.id) continue
      const result = planOne(canonical, duplicate, key)
      if (isConflict(result)) plan.conflicts.push(result)
      else plan.merges.push(result)
    }
  }
  return plan
}

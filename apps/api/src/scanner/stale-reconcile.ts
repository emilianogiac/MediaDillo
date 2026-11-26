import type { StaleFileEntry } from './stale-detector.js'

/**
 * Reconciling the recorded stale-file set against a freshly computed one.
 *
 * Kept as a pure function so the set logic can be tested without a database: the
 * cost of getting it wrong is either an unbounded table or a list that proposes
 * deleting files which are no longer stale.
 */

export interface ExistingStaleRow {
  id: string
  path: string
}

export interface StaleReconciliation {
  /** Rows to mark resolved: the path is gone, or is no longer considered stale. */
  resolveIds: string[]
  /** Paths seen as stale for the first time, which need a new row. */
  create: StaleFileEntry[]
}

/**
 * Returns true when `filePath` sits inside one of `roots`.
 *
 * A root boundary is a path separator, so "/mnt/nas/film" must not capture
 * "/mnt/nas/film_4k/...". The root itself is not a file, so it is not a match.
 */
export function isUnderRoots(filePath: string, roots: string[]): boolean {
  return roots.some((root) => {
    const prefix = root.endsWith('/') ? root : root + '/'
    return filePath.startsWith(prefix)
  })
}

/**
 * Works out which recorded stale rows to resolve and which new ones to create.
 *
 * `existing` must already be limited to unresolved rows; `scannedRoots` limits the
 * comparison to roots this scan actually walked, because a path that was not walked
 * tells us nothing about whether it is still stale. Without that scoping, a
 * single-root scan would resolve every row in the rest of the library.
 *
 * A path that is still stale keeps its existing row rather than gaining a second
 * one, which is what previously turned one stale file into one row per scan.
 */
export function reconcileStaleFiles(
  existing: ExistingStaleRow[],
  current: StaleFileEntry[],
  scannedRoots: string[]
): StaleReconciliation {
  const currentPaths = new Set(current.map((s) => s.path))

  const inScope = existing.filter((row) => isUnderRoots(row.path, scannedRoots))

  // Gone from disk, or no longer matching the stale rules — either way this scan
  // just looked and did not find it, so the row no longer describes reality.
  const resolveIds = inScope.filter((row) => !currentPaths.has(row.path)).map((row) => row.id)

  const alreadyRecorded = new Set(
    inScope.filter((row) => currentPaths.has(row.path)).map((row) => row.path)
  )

  // Deduplicate within this scan too: the same path can be reported by more than one
  // folder pass, and we only ever want one row for it.
  const seen = new Set<string>()
  const create: StaleFileEntry[] = []
  for (const entry of current) {
    if (alreadyRecorded.has(entry.path)) continue
    if (seen.has(entry.path)) continue
    seen.add(entry.path)
    create.push(entry)
  }

  return { resolveIds, create }
}

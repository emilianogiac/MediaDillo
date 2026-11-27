/**
 * Runtime display and outlier detection for the season view (issue #108).
 *
 * The point of showing a runtime at all is that it is the one signal that can
 * disagree with a filename: a 44-minute file in a season of 22-minute episodes is
 * a two-parter, a 4-minute file is an opening sequence. So the season's own files
 * are the yardstick — the median, not a provider's declared episode runtime, which
 * is often absent and sometimes wrong — and anything far from it gets flagged.
 */

/** Ratio away from the season median at which a file is called an outlier. */
const OUTLIER_FACTOR = 1.5

/** Below this, a median is too short to reason about (trailers, broken probes). */
const MIN_MEANINGFUL_MEDIAN_S = 60

export function formatRuntime(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null
  // Sub-minute clips are exactly the case worth seeing precisely — an opening
  // sequence rounded to "1m" reads like a very short episode.
  if (seconds < 60) return `${Math.round(seconds)}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/**
 * Median runtime of the files that have one, or null when too few do.
 *
 * Needs at least three known runtimes: with two, a double-length file and its
 * normal neighbour are equally "the median" and the flag would fire on whichever
 * one sorted lower.
 */
export function medianRuntime(durations: Array<number | null>): number | null {
  const known = durations.filter((d): d is number => d !== null && d > 0).sort((a, b) => a - b)
  if (known.length < 3) return null
  const mid = Math.floor(known.length / 2)
  const median = known.length % 2 === 0 ? (known[mid - 1]! + known[mid]!) / 2 : known[mid]!
  return median >= MIN_MEANINGFUL_MEDIAN_S ? median : null
}

export function isRuntimeOutlier(durationS: number | null, medianS: number | null): boolean {
  if (!durationS || durationS <= 0 || !medianS) return false
  return durationS >= medianS * OUTLIER_FACTOR || durationS <= medianS / OUTLIER_FACTOR
}

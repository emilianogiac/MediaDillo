/**
 * Decides whether two "part" files are safe to concatenate into one.
 *
 * Kept free of ffmpeg and database calls so the rules can be unit-tested directly.
 * Getting this wrong destroys data: mergeMovieParts trashes the originals and
 * repoints the DB at the output, so a wrong "yes" leaves a corrupt file in the
 * library with nothing reporting it (issue #77).
 */

export interface MediaProfile {
  /** File extension including the dot, lowercased, e.g. ".mkv" */
  container: string
  videoCodec: string | null
  width: number | null
  height: number | null
  audioCodec: string | null
  audioChannels: number | null
  /** Total number of streams in the file, including subtitles and attachments. */
  streamCount: number
  /** Playable duration in seconds, taken from the last video packet rather than the
   *  container header — headers lie (Ronin reported 176.8 min for 56.9 min of video). */
  durationS: number
}

export type MergeVerdict =
  /** Two halves of one film. */
  | 'parts'
  /** Two complete copies of the film, e.g. a 4K and a 1080p rip. */
  | 'versions'
  /** One side is a sample, trailer or stray clip. */
  | 'junk'
  /** Does not fit any known shape — never merged unattended. */
  | 'unknown'

export interface MergeAssessment {
  verdict: MergeVerdict
  mergeable: boolean
  reasons: string[]
}

/** A part smaller than this fraction of the other is a sample or trailer. */
const JUNK_RATIO = 0.1
/** A part this close to the full runtime is a complete copy, not a half. */
const FULL_COPY_RATIO = 0.85
/** How far the sum of the parts may fall short of the stated runtime. */
const SUM_SHORTFALL_RATIO = 0.8

/**
 * Classifies the pair by duration.
 *
 * `runtimeMin` is TMDB's runtime, which is the THEATRICAL cut. Extended editions
 * legitimately run far longer — the LOTR extended editions sum to 228/235/263 minutes
 * against TMDB's 179/180/201 — so the sum is only checked for falling short, never for
 * overshooting.
 */
function classifyByDuration(
  a: MediaProfile,
  b: MediaProfile,
  runtimeMin: number | null
): { verdict: MergeVerdict; reasons: string[] } {
  const reasons: string[] = []
  const shorter = Math.min(a.durationS, b.durationS)
  const longer = Math.max(a.durationS, b.durationS)

  if (longer <= 0) return { verdict: 'unknown', reasons: ['could not read a duration'] }

  if (shorter < longer * JUNK_RATIO) {
    const mins = (s: number) => `${Math.round(s)}s`
    return {
      verdict: 'junk',
      reasons: [`one part is only ${mins(shorter)} against ${mins(longer)} — a sample or trailer`],
    }
  }

  if (runtimeMin === null || runtimeMin <= 0) {
    return { verdict: 'unknown', reasons: ['no runtime known, cannot tell parts from versions'] }
  }

  const runtimeS = runtimeMin * 60
  if (shorter >= runtimeS * FULL_COPY_RATIO) {
    return {
      verdict: 'versions',
      reasons: [
        `each part runs ${Math.round(a.durationS / 60)}/${Math.round(b.durationS / 60)} min ` +
          `against a ${runtimeMin} min runtime — these are two complete copies, not halves`,
      ],
    }
  }

  const sum = a.durationS + b.durationS
  if (sum < runtimeS * SUM_SHORTFALL_RATIO) {
    reasons.push(
      `parts total ${Math.round(sum / 60)} min but the film runs ${runtimeMin} min — footage missing`
    )
    return { verdict: 'unknown', reasons }
  }

  return { verdict: 'parts', reasons }
}

/** Lists the stream-level differences that make a lossless concat impossible. */
function streamMismatches(a: MediaProfile, b: MediaProfile): string[] {
  const out: string[] = []
  if (a.container !== b.container) out.push(`container ${a.container} / ${b.container}`)
  if (a.videoCodec !== b.videoCodec) out.push(`video codec ${a.videoCodec} / ${b.videoCodec}`)
  if (a.width !== b.width || a.height !== b.height) {
    out.push(`resolution ${a.width}x${a.height} / ${b.width}x${b.height}`)
  }
  if (a.audioCodec !== b.audioCodec) out.push(`audio codec ${a.audioCodec} / ${b.audioCodec}`)
  if (a.audioChannels !== b.audioChannels) {
    out.push(`audio channels ${a.audioChannels} / ${b.audioChannels}`)
  }
  if (a.streamCount !== b.streamCount) {
    // Not cosmetic: the extra tracks exist in only one half, so a concat drops them.
    out.push(`track count ${a.streamCount} / ${b.streamCount} — tracks would be lost`)
  }
  return out
}

/**
 * Returns whether `part1` and `part2` may be concatenated with a stream copy.
 *
 * Only a pair classified `parts` with no stream mismatch is mergeable.
 */
export function assessMerge(
  part1: MediaProfile,
  part2: MediaProfile,
  runtimeMin: number | null
): MergeAssessment {
  const { verdict, reasons } = classifyByDuration(part1, part2, runtimeMin)
  const mismatches = streamMismatches(part1, part2)
  const all = [...reasons, ...mismatches]

  if (verdict !== 'parts') return { verdict, mergeable: false, reasons: all }
  if (mismatches.length > 0) return { verdict: 'parts', mergeable: false, reasons: all }
  return { verdict: 'parts', mergeable: true, reasons: [] }
}

/** How far the merged file's duration may stray from the sum of its parts. */
const OUTPUT_TOLERANCE = 0.01

/**
 * Checks a freshly written merge before the originals are thrown away.
 *
 * ffmpeg routinely exits 0 on a bad `-c copy` concat, so a zero exit code is not
 * evidence that the output is whole.
 */
export function verifyMergedOutput(
  output: MediaProfile,
  part1: MediaProfile,
  part2: MediaProfile
): { ok: boolean; error?: string } {
  if (!output.videoCodec) return { ok: false, error: 'merged file has no video stream' }
  // Duration alone cannot catch a track-stripped concat: the film runs end to end, it
  // just lost tracks. assessMerge has already proven the parts' stream counts equal, so
  // the output must carry the same number (issue #80).
  if (output.streamCount < part1.streamCount) {
    return {
      ok: false,
      error:
        `merged file has ${output.streamCount} streams but the parts had ` +
        `${part1.streamCount} — tracks were dropped`,
    }
  }
  const expected = part1.durationS + part2.durationS
  if (expected <= 0) return { ok: false, error: 'could not determine expected duration' }
  const drift = Math.abs(output.durationS - expected) / expected
  if (drift > OUTPUT_TOLERANCE) {
    return {
      ok: false,
      error:
        `merged duration ${Math.round(output.durationS)}s differs from the expected ` +
        `${Math.round(expected)}s by ${(drift * 100).toFixed(1)}%`,
    }
  }
  return { ok: true }
}

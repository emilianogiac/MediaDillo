/**
 * Backfill `durationS` on file rows scanned before the probe asked for it (issue #108).
 *
 * This is a script rather than a startup migration or a route: it is ~12k ffprobe calls
 * against the NAS, which is far too slow to block API boot and far too slow for a
 * request to survive. Run it once per deployment:
 *
 *   docker compose exec app sh -c "cd apps/api && npx tsx src/scripts/backfill-durations.ts"
 *
 * Flags: --dry-run (probe and report, write nothing), --limit N, --concurrency N.
 *
 * Only NULL rows are touched, so the run is idempotent and safe to interrupt and resume.
 */
import { prisma } from '@mediadillo/db'
import { extractTechSpecs } from '../scanner/ffprobe.js'

export interface BackfillOptions {
  dryRun?: boolean
  limit?: number
  concurrency?: number
  /** Injectable for tests; defaults to the real ffprobe call. */
  probe?: (filePath: string) => Promise<number | null>
  onProgress?: (done: number, total: number) => void
}

export interface BackfillResult {
  episodeFiles: TableResult
  movieFiles: TableResult
}

export interface TableResult {
  candidates: number
  updated: number
  unreadable: number
}

const DEFAULT_CONCURRENCY = 4

export async function backfillDurations(options: BackfillOptions = {}): Promise<BackfillResult> {
  const probe = options.probe ?? probeDuration
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)

  const episodeRows = await prisma.episodeFile.findMany({
    where: { durationS: null },
    select: { id: true, path: true },
    ...(options.limit ? { take: options.limit } : {}),
  })
  const movieRows = await prisma.movieFile.findMany({
    where: { durationS: null },
    select: { id: true, path: true },
    ...(options.limit ? { take: options.limit } : {}),
  })

  const total = episodeRows.length + movieRows.length
  let done = 0
  const tick = (): void => {
    done++
    options.onProgress?.(done, total)
  }

  const episodeFiles = await processRows(episodeRows, async (id, durationS) => {
    await prisma.episodeFile.update({ where: { id }, data: { durationS } })
  }, { probe, concurrency, dryRun: options.dryRun === true, tick })

  const movieFiles = await processRows(movieRows, async (id, durationS) => {
    await prisma.movieFile.update({ where: { id }, data: { durationS } })
  }, { probe, concurrency, dryRun: options.dryRun === true, tick })

  return { episodeFiles, movieFiles }
}

interface ProcessContext {
  probe: (filePath: string) => Promise<number | null>
  concurrency: number
  dryRun: boolean
  tick: () => void
}

async function processRows(
  rows: Array<{ id: string; path: string }>,
  write: (id: string, durationS: number) => Promise<void>,
  ctx: ProcessContext,
): Promise<TableResult> {
  const result: TableResult = { candidates: rows.length, updated: 0, unreadable: 0 }
  let next = 0

  // A fixed pool rather than Promise.all over everything: 12k concurrent ffprobe
  // processes would exhaust file handles long before the NAS became the bottleneck.
  const workers = Array.from({ length: Math.min(ctx.concurrency, rows.length) }, async () => {
    for (;;) {
      const row = rows[next++]
      if (!row) return
      const durationS = await ctx.probe(row.path)
      if (durationS === null) {
        result.unreadable++
        console.warn(`[backfill] no duration: ${row.path}`)
      } else {
        if (!ctx.dryRun) await write(row.id, durationS)
        result.updated++
      }
      ctx.tick()
    }
  })

  await Promise.all(workers)
  return result
}

async function probeDuration(filePath: string): Promise<number | null> {
  const specs = await extractTechSpecs(filePath)
  return specs.durationS
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const limitRaw = flag('limit')
  const concurrencyRaw = flag('concurrency')

  const result = await backfillDurations({
    dryRun: argv.includes('--dry-run'),
    ...(limitRaw ? { limit: Number.parseInt(limitRaw, 10) } : {}),
    ...(concurrencyRaw ? { concurrency: Number.parseInt(concurrencyRaw, 10) } : {}),
    onProgress: (done, total) => {
      if (done % 100 === 0 || done === total) console.log(`[backfill] ${done}/${total}`)
    },
  })

  console.log('[backfill] episode files:', result.episodeFiles)
  console.log('[backfill] movie files:', result.movieFiles)
  await prisma.$disconnect()
}

// Only run when invoked directly, so the module stays importable from tests.
if (process.argv[1]?.endsWith('backfill-durations.ts') || process.argv[1]?.endsWith('backfill-durations.js')) {
  main().catch((err: unknown) => {
    console.error('[backfill] failed:', err)
    process.exitCode = 1
  })
}

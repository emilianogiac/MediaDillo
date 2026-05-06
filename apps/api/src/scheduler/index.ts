import { prisma } from '@mediadillo/db'
import { runScan, isScanRunning } from '../scanner/index.js'
import { config } from '../config.js'

export type ScheduleInterval = 'disabled' | '1h' | '6h' | '12h' | '24h'

const INTERVAL_MS: Record<Exclude<ScheduleInterval, 'disabled'>, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
}

const SCHEDULE_KEY = 'scan.schedule'

let currentTimer: ReturnType<typeof setInterval> | null = null

export async function getSchedule(): Promise<ScheduleInterval> {
  const setting = await prisma.setting.findUnique({ where: { key: SCHEDULE_KEY } })
  const val = setting?.value ?? 'disabled'
  return isValidSchedule(val) ? val : 'disabled'
}

export async function setSchedule(interval: ScheduleInterval): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SCHEDULE_KEY },
    create: { key: SCHEDULE_KEY, value: interval },
    update: { value: interval },
  })
  applySchedule(interval)
}

function applySchedule(interval: ScheduleInterval): void {
  if (currentTimer) {
    clearInterval(currentTimer)
    currentTimer = null
  }
  if (interval === 'disabled') return

  const ms = INTERVAL_MS[interval]
  currentTimer = setInterval(async () => {
    if (isScanRunning() || config.SCAN_ROOTS.length === 0) return
    try {
      await runScan(config.SCAN_ROOTS)
    } catch (err) {
      console.error('Scheduled scan failed:', err)
    }
  }, ms)
}

export async function initScheduler(): Promise<void> {
  const schedule = await getSchedule()
  applySchedule(schedule)
}

function isValidSchedule(val: string): val is ScheduleInterval {
  return ['disabled', '1h', '6h', '12h', '24h'].includes(val)
}

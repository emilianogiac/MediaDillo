import { randomUUID } from 'node:crypto'

export interface JobState {
  id: string
  running: boolean
  total: number
  done: number
  errors: string[]
  startedAt: string
  finishedAt: string | null
}

const jobs = new Map<string, JobState>()

export function createJob(total: number): JobState {
  const job: JobState = {
    id: randomUUID(),
    running: true,
    total,
    done: 0,
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
  jobs.set(job.id, job)
  return job
}

export function getJob(id: string): JobState | undefined {
  return jobs.get(id)
}

export function tickJob(id: string): void {
  const job = jobs.get(id)
  if (job) job.done++
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id)
  if (job) job.errors.push(error)
}

export function finishJob(id: string): void {
  const job = jobs.get(id)
  if (job) {
    job.running = false
    job.finishedAt = new Date().toISOString()
  }
}

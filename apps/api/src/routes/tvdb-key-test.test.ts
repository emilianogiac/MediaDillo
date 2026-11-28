import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

/**
 * Issue #66 — a Test action for the TVDB key, so a user can verify what they
 * typed before saving it. The probe reports a reason rather than a bare
 * boolean: "key rejected" and "TVDB unreachable" are different problems, and on
 * this deployment the second genuinely happens.
 */
vi.mock('../config.js', () => ({
  config: { NODE_ENV: 'test', PORT: 7731, DATABASE_URL: 'postgresql://test', SCAN_ROOTS: [] },
}))
vi.mock('@mediadillo/db', () => ({
  prisma: { setting: { findUnique: vi.fn(), upsert: vi.fn() }, scanRoot: { findMany: vi.fn() } },
}))
vi.mock('../scheduler/index.js', () => ({ getSchedule: vi.fn(), setSchedule: vi.fn() }))
vi.mock('../api-config.js', () => ({
  getApiConfig: vi.fn(async () => ({})),
  invalidateApiConfigCache: vi.fn(),
  API_CONFIG_DB_KEYS: {},
}))
vi.mock('../jellyfin/client.js', () => ({ testJellyfinConnection: vi.fn() }))
vi.mock('../shows/counts.js', () => ({
  recalculateShowCounts: vi.fn(), recalculateManyShowCounts: vi.fn(),
}))
vi.mock('../shows/dedup.js', () => ({ planDedup: vi.fn(() => ({ merges: [], conflicts: [] })) }))
vi.mock('../scanner/reprobe.js', () => ({ reprobeStaleFiles: vi.fn() }))
vi.mock('../activity/log.js', () => ({ logActivity: vi.fn() }))

const { settingsRoutes } = await import('./settings.js')

async function buildApp() {
  const app = Fastify()
  await app.register(settingsRoutes)
  return app
}

const originalFetch = global.fetch
afterEach(() => { global.fetch = originalFetch })
beforeEach(() => vi.clearAllMocks())

describe('POST /settings/api-keys/test-tvdb', () => {
  it('reports a working key as valid', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 })) as never
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/settings/api-keys/test-tvdb', payload: { apiKey: 'good-key' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ valid: true })
  })

  it('distinguishes a rejected key from an unreachable provider', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401 })) as never
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/settings/api-keys/test-tvdb', payload: { apiKey: 'bad-key' },
    })
    expect(res.json()).toMatchObject({ valid: false })
    expect(res.json().error).toMatch(/401/)
  })

  it('surfaces a network failure as unreachable, not as a bad key', async () => {
    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as never
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/settings/api-keys/test-tvdb', payload: { apiKey: 'any-key' },
    })
    expect(res.json()).toMatchObject({ valid: false })
    expect(res.json().error).toMatch(/Could not reach TVDB/)
    expect(res.json().error).toMatch(/ECONNREFUSED/)
  })

  it('reports an unexpected status with its code', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503 })) as never
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/settings/api-keys/test-tvdb', payload: { apiKey: 'k' },
    })
    expect(res.json().error).toMatch(/HTTP 503/)
  })

  it('rejects an empty key without calling TVDB', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as never
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/settings/api-keys/test-tvdb', payload: { apiKey: '   ' },
    })
    expect(res.json()).toEqual({ valid: false, error: 'No API key provided' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('400s when apiKey is missing entirely', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/settings/api-keys/test-tvdb', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('does not persist the key it was asked to test', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 })) as never
    const { prisma } = await import('@mediadillo/db')
    const app = await buildApp()
    await app.inject({
      method: 'POST', url: '/settings/api-keys/test-tvdb', payload: { apiKey: 'probe-only' },
    })
    expect(prisma.setting.upsert).not.toHaveBeenCalled()
  })
})

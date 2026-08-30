import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startBridge, type Bridge } from './bridge.ts'
import { CheckinOrchestrator, type ApiAdapters } from './checkin.ts'

let dir: string
let bridge: Bridge | null

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dshpc-'))
  process.env.DSH_POINTS_CHECKIN_DIR = dir
})

afterEach(() => {
  bridge?.close()
  bridge = null
  delete process.env.DSH_POINTS_CHECKIN_DIR
  rmSync(dir, { recursive: true, force: true })
})

function traeCredential() {
  return { ideToken: 'tok', appId: '', clientId: '', userId: '', expiresAtMs: 0, device: { deviceId: 'dev' }, source: 'manual' as const }
}

function fakeApis(): ApiAdapters {
  return {
    trae: {
      resolve: vi.fn(async () => traeCredential()),
      status: vi.fn(async () => ({ enable: true, checkedIn: false, credits: 7 })),
      entitlements: vi.fn(async () => ({ remaining: 7, totalAmount: 10, consumedAmount: 3 })),
      claim: vi.fn(async () => undefined),
      refresh: vi.fn(async (c) => c),
    },
    workbuddy: {
      resolve: vi.fn(async () => ({ accessToken: 'wb', refreshToken: 'r', expiresAtMs: 0, uid: '', domain: '', source: 'manual' as const })),
      status: vi.fn(async () => ({ checkedIn: false, points: null, accounts: [] })),
      points: vi.fn(async () => [{ packageName: 'Pro', remain: 7, size: 10 }]),
      claim: vi.fn(async () => undefined),
      refresh: vi.fn(async (c) => c),
    },
  }
}

async function startWith(orch: CheckinOrchestrator): Promise<Bridge> {
  const started = await startBridge(orch, () => {}, [28082, 28083, 28084])
  if (!started) throw new Error('bridge failed to start in test')
  bridge = started
  return started
}

describe('bridge', () => {
  it('answers /ping', async () => {
    const { port } = await startWith(new CheckinOrchestrator(fakeApis()))
    const res = await fetch(`http://127.0.0.1:${port}/ping`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, plugin: 'points-checkin' })
  })

  it('serves CORS headers and preflight', async () => {
    const { port } = await startWith(new CheckinOrchestrator(fakeApis()))
    const res = await fetch(`http://127.0.0.1:${port}/ping`, {
      headers: { origin: 'http://127.0.0.1:5173' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-private-network')).toBe('true')
  })

  it('rejects non-localhost origins', async () => {
    const { port } = await startWith(new CheckinOrchestrator(fakeApis()))
    const res = await fetch(`http://127.0.0.1:${port}/credentials`, {
      headers: { origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
  })

  it('persists credentials via POST and echoes them via GET', async () => {
    const { port } = await startWith(new CheckinOrchestrator(fakeApis()))
    const save = await fetch(`http://127.0.0.1:${port}/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trae: { token: 'tok-1', deviceId: 'dev-9' } }),
    })
    expect(save.status).toBe(200)
    const read = (await (await fetch(`http://127.0.0.1:${port}/credentials`)).json()) as {
      trae: { configured: boolean; token: string; deviceId: string }
    }
    expect(read.trae).toEqual({ configured: true, token: 'tok-1', deviceId: 'dev-9' })
  })

  it('exposes state and manual check-in', async () => {
    const apis = fakeApis()
    const { port } = await startWith(new CheckinOrchestrator(apis))
    await fetch(`http://127.0.0.1:${port}/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workbuddy: { token: 'wb' } }),
    })
    const state = (await (await fetch(`http://127.0.0.1:${port}/state`)).json()) as {
      workbuddy: { configured: boolean; checkedIn: boolean | null }
    }
    expect(state.workbuddy.configured).toBe(true)
    const after = (await (await fetch(`http://127.0.0.1:${port}/checkin/workbuddy`, { method: 'POST' })).json()) as {
      workbuddy: { checkedIn: boolean | null }
    }
    expect(after.workbuddy.checkedIn).toBe(true)
    expect(apis.workbuddy.claim).toHaveBeenCalled()
  })

  it('returns 404 for unknown routes', async () => {
    const { port } = await startWith(new CheckinOrchestrator(fakeApis()))
    const res = await fetch(`http://127.0.0.1:${port}/nope`)
    expect(res.status).toBe(404)
  })
})

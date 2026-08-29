import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CheckinOrchestrator, type ApiAdapters } from './checkin.ts'
import { ApiError } from './errors.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dshpc-'))
  process.env.DSH_POINTS_CHECKIN_DIR = dir
})

afterEach(() => {
  delete process.env.DSH_POINTS_CHECKIN_DIR
  rmSync(dir, { recursive: true, force: true })
})

function fakeApis(): ApiAdapters {
  return {
    trae: {
      status: vi.fn(async () => ({ enable: true, checkedIn: false, credits: 120 })),
      claim: vi.fn(async () => undefined),
    },
    workbuddy: {
      status: vi.fn(async () => ({ checkedIn: false })),
      claim: vi.fn(async () => undefined),
      resource: vi.fn(async () => ({ list: [], total: 3 })),
    },
  }
}

describe('CheckinOrchestrator', () => {
  it('reports unconfigured services', async () => {
    const orch = new CheckinOrchestrator(fakeApis())
    const snap = await orch.snapshot(true)
    expect(snap.trae.configured).toBe(false)
    expect(snap.workbuddy.configured).toBe(false)
  })

  it('stores credentials and probes the status', async () => {
    const apis = fakeApis()
    const orch = new CheckinOrchestrator(apis)
    await orch.setCredentials({ trae: { token: 'tok' }, workbuddy: { token: 'wb', userId: 'u1' } })
    const snap = await orch.snapshot(true)
    expect(snap.trae.configured).toBe(true)
    expect(snap.trae.checkedIn).toBe(false)
    expect(snap.trae.points).toBe(120)
    expect(snap.workbuddy.configured).toBe(true)
    expect(apis.trae.status).toHaveBeenCalledWith('tok', '')
    expect(apis.workbuddy.status).toHaveBeenCalledWith({ token: 'wb', userId: 'u1' })
  })

  it('claims and records the local date', async () => {
    const apis = fakeApis()
    const orch = new CheckinOrchestrator(apis)
    await orch.setCredentials({ trae: { token: 'tok' } })
    await orch.checkin('trae')
    const snap = await orch.snapshot(true)
    expect(apis.trae.claim).toHaveBeenCalledWith('tok', '')
    expect(snap.trae.checkedIn).toBe(true)
    expect(snap.trae.lastCheckin).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('ensureToday claims when enabled and unchecked, skips when checked', async () => {
    const apis = fakeApis()
    const orch = new CheckinOrchestrator(apis)
    await orch.setCredentials({ trae: { token: 'tok' }, workbuddy: { token: 'wb' } })
    await orch.ensureToday()
    expect(apis.trae.claim).toHaveBeenCalled()
    expect(apis.workbuddy.claim).toHaveBeenCalled()

    const apisDone = fakeApis()
    ;(apisDone.trae.status as ReturnType<typeof vi.fn>).mockResolvedValue({ enable: true, checkedIn: true, credits: 130 })
    ;(apisDone.workbuddy.status as ReturnType<typeof vi.fn>).mockResolvedValue({ checkedIn: true })
    const orchDone = new CheckinOrchestrator(apisDone)
    await orchDone.setCredentials({ trae: { token: 'tok' }, workbuddy: { token: 'wb' } })
    await orchDone.ensureToday()
    expect(apisDone.trae.claim).not.toHaveBeenCalled()
    expect(apisDone.workbuddy.claim).not.toHaveBeenCalled()
  })

  it('ensureToday skips disabled campaigns and never throws on failures', async () => {
    const apis = fakeApis()
    ;(apis.trae.status as ReturnType<typeof vi.fn>).mockResolvedValue({ enable: false, checkedIn: false, credits: 0 })
    ;(apis.workbuddy.status as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError('network', 'down'))
    const orch = new CheckinOrchestrator(apis)
    await orch.setCredentials({ trae: { token: 'tok' }, workbuddy: { token: 'wb' } })
    await expect(orch.ensureToday()).resolves.toBeUndefined()
    const snap = await orch.snapshot(true)
    expect(snap.trae.error).toBeUndefined()
    expect(snap.workbuddy.error).toBe('network')
  })

  it('marks auth failures on the runtime', async () => {
    const apis = fakeApis()
    ;(apis.trae.status as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError('auth', 'bad token'))
    const orch = new CheckinOrchestrator(apis)
    await orch.setCredentials({ trae: { token: 'tok' } })
    const snap = await orch.snapshot(true)
    expect(snap.trae.authOk).toBe(false)
    expect(snap.trae.error).toBe('auth')
  })

  it('drops a service when the token field is cleared', async () => {
    const orch = new CheckinOrchestrator(fakeApis())
    await orch.setCredentials({ trae: { token: 'tok' } })
    await orch.setCredentials({ trae: { token: '' } })
    const snap = await orch.snapshot()
    expect(snap.trae.configured).toBe(false)
  })
})

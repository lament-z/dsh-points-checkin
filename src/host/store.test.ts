import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readCredentials, readState, writeCredentials, writeState, todayLocal } from './store.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dshpc-'))
  process.env.DSH_POINTS_CHECKIN_DIR = dir
})

afterEach(() => {
  delete process.env.DSH_POINTS_CHECKIN_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('store', () => {
  it('round-trips credentials', async () => {
    expect(await readCredentials()).toEqual({})
    await writeCredentials({ trae: { token: 't-1' } })
    expect(await readCredentials()).toEqual({ trae: { token: 't-1' } })
  })

  it('round-trips state', async () => {
    expect(await readState()).toEqual({})
    await writeState({ trae: { lastCheckin: '2026-08-29' } })
    expect(await readState()).toEqual({ trae: { lastCheckin: '2026-08-29' } })
  })

  it('writes files with owner-only permissions', async () => {
    await writeCredentials({ trae: { token: 'secret' } })
    const mode = statSync(path.join(dir, 'credentials.json')).mode & 0o777
    expect(mode).toBe(0o600)
    expect(existsSync(path.join(dir, 'credentials.json.tmp'))).toBe(false)
  })

  it('round-trips settings and rejects malformed times', async () => {
    const { readSettings, writeSettings, DEFAULT_SETTINGS } = await import('./store.ts')
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS)
    await writeSettings({ checkinTime: '08:30' })
    expect(await readSettings()).toEqual({ checkinTime: '08:30' })
    await writeSettings({ checkinTime: 'bad' })
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('formats the local date as YYYY-MM-DD', () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

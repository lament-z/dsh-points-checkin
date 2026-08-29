/**
 * Durable storage for the points-checkin plugin: credentials and check-in
 * state as JSON files under ~/.dsh-points-checkin (0600). Tokens never reach
 * logs; the directory can be overridden for tests.
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Credential material for one service. */
export interface TraeCredentials {
  /** Cloud-IDE-JWT token captured from the TRAE client or web console. */
  token: string
  /** Optional x-device-id value; defaults to a stable plugin-local id. */
  deviceId?: string
}

/** Credential material for the WorkBuddy (CodeBuddy) meter API. */
export interface WorkbuddyCredentials {
  /** Bearer token captured from the web console or client traffic. */
  token: string
  /** Optional X-User-Id header value injected alongside the bearer token. */
  userId?: string
}

/** All configured credentials, keyed by service. */
export interface Credentials {
  trae?: TraeCredentials
  workbuddy?: WorkbuddyCredentials
}

/** Per-service durable check-in state. */
export interface ServiceState {
  /** Local calendar date (YYYY-MM-DD) of the last successful claim. */
  lastCheckin?: string
}

/** Durable state for every service. */
export interface CheckinState {
  trae?: ServiceState
  workbuddy?: ServiceState
}

/** Storage directory (overridable for tests via DSH_POINTS_CHECKIN_DIR). */
export function storeDir(): string {
  return process.env.DSH_POINTS_CHECKIN_DIR ?? path.join(homedir(), '.dsh-points-checkin')
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path.join(storeDir(), file), 'utf8')) as T
  } catch {
    return undefined
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const dir = storeDir()
  await mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `${file}.tmp`)
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, path.join(dir, file))
}

/** Load credentials; undefined fields mean unset. */
export async function readCredentials(): Promise<Credentials> {
  return (await readJson<Credentials>('credentials.json')) ?? {}
}

/** Persist credentials atomically with owner-only permissions. */
export async function writeCredentials(credentials: Credentials): Promise<void> {
  await writeJson('credentials.json', credentials)
}

/** Load check-in state. */
export async function readState(): Promise<CheckinState> {
  return (await readJson<CheckinState>('state.json')) ?? {}
}

/** Persist check-in state atomically. */
export async function writeState(state: CheckinState): Promise<void> {
  await writeJson('state.json', state)
}

/** Local calendar date (YYYY-MM-DD) for "checked in today" comparisons. */
export function todayLocal(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

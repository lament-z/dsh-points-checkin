/**
 * WorkBuddy (CodeBuddy) upstream client, modeled on dsh-workbuddy-connect
 * 0.2.3 (the sanctioned integration this plugin defers to).
 *
 * Credential source: the WorkBuddy desktop app stores a plaintext auth
 * document (accessToken/refreshToken/expiry + account identity) at
 * ~/Library/Application Support/CodeBuddyExtension/Data/Public/auth/
 * workbuddy-desktop.info. This module reads it read-only, keeps refreshed
 * tokens in its own copy under the plugin store (the later expiry wins, so
 * a refresh by either side is honored), and auto-refreshes via the
 * X-Refresh-Token endpoint before expiry.
 *
 * Endpoints (CN): billing https://www.codebuddy.cn (meter paths carry the
 * /v2 prefix with Bearer auth), chat https://copilot.tencent.com.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ApiError } from './errors.ts'
import type { FetchFn } from './trae.ts'
import { storeDir } from './store.ts'

/** Desktop auth file candidates (probe order; mirrors dsh-workbuddy-connect). */
export function desktopAuthCandidates(): string[] {
  const home = homedir()
  if (process.platform === 'darwin') {
    return [join(home, 'Library', 'Application Support', 'CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info')]
  }
  if (process.platform === 'win32') {
    return [
      join(home, 'AppData', 'Local', 'CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info'),
      join(home, 'AppData', 'Roaming', 'CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info'),
    ]
  }
  return [join(home, '.config', 'CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info')]
}

/** Resolved WorkBuddy credential. */
export interface WbCredential {
  accessToken: string
  refreshToken: string
  expiresAtMs: number
  refreshExpiresAtMs?: number
  uid: string
  enterpriseId?: string
  domain: string
  /** Where the credential came from (panel display only). */
  source: 'desktop' | 'plugin-copy' | 'manual'
}

/** Expiry may arrive in seconds or milliseconds. */
function expiryToMs(value: number): number {
  if (value <= 0) return 0
  return value > 0xe8d4a51000 ? value : value * 1e3
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Parse the desktop document in either shape (nested auth/account or flat). */
export function parseDesktopAuth(text: string): WbCredential | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const document = parsed as Record<string, unknown>
  const auth = (typeof document['auth'] === 'object' && document['auth'] !== null
    ? document['auth']
    : document) as Record<string, unknown>
  const identity = (typeof document['auth'] === 'object' && document['auth'] !== null
    ? (document['account'] ?? {}) 
    : document) as Record<string, unknown>
  const accessToken = typeof auth['accessToken'] === 'string' ? auth['accessToken'] : ''
  if (accessToken === '') return undefined
  const enterpriseId = optionalString(identity['enterpriseId'])
  return {
    accessToken,
    refreshToken: typeof auth['refreshToken'] === 'string' ? auth['refreshToken'] : '',
    expiresAtMs: typeof auth['expiresAt'] === 'number' ? expiryToMs(auth['expiresAt']) : 0,
    ...(typeof auth['refreshExpiresAt'] === 'number' ? { refreshExpiresAtMs: expiryToMs(auth['refreshExpiresAt']) } : {}),
    uid: optionalString(identity['uid']) ?? '',
    ...(enterpriseId === undefined ? {} : { enterpriseId }),
    domain: optionalString(auth['domain']) ?? '',
    source: 'desktop',
  }
}

/** Plugin-owned copy path (refreshed tokens land here; desktop file is never written). */
function ownCopyPath(): string {
  return join(storeDir(), 'workbuddy-auth-copy.json')
}

async function readOwnCopy(): Promise<WbCredential | undefined> {
  try {
    const text = await readFile(ownCopyPath(), 'utf8')
    const parsed = JSON.parse(text) as { credential?: WbCredential }
    if (parsed?.credential?.accessToken) return { ...parsed.credential, source: 'plugin-copy' }
  } catch {
    // Absent or unreadable copy falls through to the desktop file.
  }
  return undefined
}

async function writeOwnCopy(credential: WbCredential): Promise<void> {
  await writeFile(ownCopyPath(), JSON.stringify({ version: 1, credential }, null, 2), { mode: 0o600 })
}

/** Later expiry wins, so a refresh by either the app or this plugin is honored. */
function laterExpiry(a: WbCredential, b: WbCredential): WbCredential {
  return (b.expiresAtMs || 0) > (a.expiresAtMs || 0) ? b : a
}

/** Best available credential: manual token, else plugin copy vs desktop file. */
export async function resolveStoredCredential(manualToken?: string): Promise<WbCredential | undefined> {
  if (manualToken) {
    return {
      accessToken: manualToken,
      refreshToken: '',
      expiresAtMs: 0,
      uid: '',
      domain: '',
      source: 'manual',
    }
  }
  let credential = await readOwnCopy()
  for (const candidate of desktopAuthCandidates()) {
    try {
      const parsed = parseDesktopAuth(await readFile(candidate, 'utf8'))
      if (!parsed) continue
      credential = credential ? laterExpiry(credential, parsed) : parsed
    } catch {
      // Missing/unreadable candidate: try the next one.
    }
  }
  return credential
}

/** Persist a refreshed credential into the plugin-owned copy. */
export async function persistRefreshedCredential(credential: WbCredential): Promise<void> {
  await writeOwnCopy(credential)
}

const CN_BILLING_BASE = 'https://www.codebuddy.cn'
const GLOBAL_BILLING_BASE = 'https://www.workbuddy.ai'
const CN_CHAT_BASE = 'https://copilot.tencent.com'
const GLOBAL_CHAT_BASE = 'https://www.workbuddy.ai'
/** Mirrors the official CLI UA the upstream expects. */
const CLIENT_UA = 'CLI/2.63.2 CodeBuddy/2.63.2'

function isGlobal(domain: string): boolean {
  const lowered = domain.trim().toLowerCase()
  return lowered === 'workbuddy.ai' || lowered.endsWith('.workbuddy.ai')
}

function billingBase(credential: WbCredential): string {
  return isGlobal(credential.domain) ? GLOBAL_BILLING_BASE : CN_BILLING_BASE
}

function chatBase(credential: WbCredential): string {
  return isGlobal(credential.domain) ? GLOBAL_CHAT_BASE : CN_CHAT_BASE
}

export function billingHeaders(credential: WbCredential): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${credential.accessToken}`,
    accept: 'application/json',
    'content-type': 'application/json',
    'user-agent': CLIENT_UA,
  }
  if (credential.uid !== '') headers['x-user-id'] = credential.uid
  if (credential.enterpriseId) {
    headers['x-enterprise-id'] = credential.enterpriseId
    headers['x-tenant-id'] = credential.enterpriseId
  }
  if (credential.domain !== '') headers['x-domain'] = credential.domain
  return headers
}

async function readEnvelope(res: Response): Promise<{ code?: number; data?: unknown; msg?: string }> {
  try {
    return (await res.json()) as { code?: number; data?: unknown; msg?: string }
  } catch {
    throw new ApiError('protocol', 'workbuddy returned a non-JSON body')
  }
}

async function billingPost(
  credential: WbCredential,
  path: string,
  body: Record<string, unknown>,
  fetchFn: FetchFn,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetchFn(`${billingBase(credential)}${path}`, {
      method: 'POST',
      headers: billingHeaders(credential),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (cause) {
    throw new ApiError('network', `workbuddy ${path} request failed: ${String(cause)}`)
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiError('auth', `workbuddy ${path} rejected the credential (HTTP ${res.status})`)
  }
  let envelope: { code?: number; data?: unknown; msg?: string } = {}
  try {
    envelope = (await res.json()) as { code?: number; data?: unknown; msg?: string }
  } catch {
    if (!res.ok) throw new ApiError('network', `workbuddy ${path} returned HTTP ${res.status}`)
    throw new ApiError('protocol', `workbuddy ${path} returned a non-JSON body`)
  }
  // Business errors may ride on non-2xx statuses (e.g. HTTP 400 + code 10001
  // for "already checked in today"); surface the code before the HTTP class.
  if (typeof envelope.code === 'number' && envelope.code !== 0) {
    throw new ApiError('business', `workbuddy ${path} business error ${envelope.code}: ${envelope.msg ?? ''}`, envelope.code)
  }
  if (!res.ok) throw new ApiError('network', `workbuddy ${path} returned HTTP ${res.status}`)
  return envelope.data ?? envelope
}

/** POST with the /v2 prefix first, falling back to the bare path (web-console shape). */
async function billingPostWithFallback(
  credential: WbCredential,
  path: string,
  body: Record<string, unknown>,
  fetchFn: FetchFn,
): Promise<unknown> {
  try {
    return await billingPost(credential, `/v2${path}`, body, fetchFn)
  } catch (cause) {
    if (cause instanceof ApiError && (cause.kind === 'protocol' || cause.message.includes('HTTP 404'))) {
      return billingPost(credential, path, body, fetchFn)
    }
    throw cause
  }
}

export interface WorkbuddyStatus {
  checkedIn: boolean | null
  /** Aggregated remaining credit across the account's packages. */
  points: number | null
  /** Per-package breakdown (packageName + remain). */
  accounts: Array<{ packageName: string; remain: number; size: number }>
}

function extractRemain(account: Record<string, unknown>): { remain: number; size: number } {
  const num = (key: string): number => (typeof account[key] === 'number' ? (account[key] as number) : 0)
  const size = num('CycleCapacitySize')
  const cycleRemain = num('CycleCapacityRemain')
  const cycleUsed = num('CycleCapacityUsed')
  const remain = size > 0 || cycleRemain > 0 || cycleUsed > 0 ? cycleRemain : num('CapacityRemain')
  return { remain: Math.max(0, remain), size: size > 0 ? size : num('CapacitySize') }
}

/** Sum remaining credit across packages, per the official client's algorithm. */
export function parseAccounts(data: unknown): WorkbuddyStatus['accounts'] {
  const wrapper = (data as Record<string, unknown>) ?? {}
  const response = (wrapper['Response'] as Record<string, unknown>) ?? {}
  const inner = (response['Data'] as Record<string, unknown>) ?? (wrapper['Data'] as Record<string, unknown>) ?? {}
  const rawAccounts = Array.isArray(inner['Accounts']) ? (inner['Accounts'] as unknown[]) : []
  const accounts: WorkbuddyStatus['accounts'] = []
  for (const raw of rawAccounts) {
    if (typeof raw !== 'object' || raw === null) continue
    const account = raw as Record<string, unknown>
    const { remain, size } = extractRemain(account)
    accounts.push({
      packageName: typeof account['PackageName'] === 'string' ? (account['PackageName'] as string) : '(unnamed)',
      remain,
      size,
    })
  }
  return accounts
}

function formatLocal(date: Date): string {
  const pad = (n: number, width = 2): string => n.toString().padStart(width, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Query the aggregated remaining credit (and package breakdown). */
export async function workbuddyPoints(
  credential: WbCredential,
  fetchFn: FetchFn = fetch,
): Promise<WorkbuddyStatus['accounts']> {
  const now = new Date()
  const data = await billingPostWithFallback(credential, '/billing/meter/get-user-resource', {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: 'p_tcaca',
    Status: [0, 3],
    PackageEndTimeRangeBegin: formatLocal(now),
    PackageEndTimeRangeEnd: formatLocal(new Date(now.getTime() + 3185136e6)),
  }, fetchFn)
  return parseAccounts(data)
}

function parseCheckedIn(data: unknown): boolean | null {
  if (typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    if (/checked|signed|is_check|today/i.test(key) && typeof value === 'boolean') return value
  }
  return null
}

/**
 * Query the daily check-in status. The check-in endpoints are known only in
 * the web-console shape (no /v2 evidence exists), so only the bare path is
 * tried; an unknown data shape surfaces as null rather than an error.
 */
export async function workbuddyStatus(
  credential: WbCredential,
  fetchFn: FetchFn = fetch,
): Promise<WorkbuddyStatus> {
  const data = await billingPost(credential, '/billing/meter/checkin-status', {}, fetchFn)
  return { checkedIn: parseCheckedIn(data), points: null, accounts: [] }
}

/** Business code the upstream returns when today's reward was already claimed. */
const ALREADY_CHECKED_IN_CODE = 10001

/** Claim today's check-in reward; an already-claimed day counts as success. */
export async function workbuddyClaim(
  credential: WbCredential,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  try {
    await billingPost(credential, '/billing/meter/daily-checkin', {}, fetchFn)
  } catch (cause) {
    if (cause instanceof ApiError && cause.kind === 'business' && cause.code === ALREADY_CHECKED_IN_CODE) {
      return
    }
    throw cause
  }
}

/** Exchange the refresh token for a fresh access token. */
export async function workbuddyRefresh(
  credential: WbCredential,
  fetchFn: FetchFn = fetch,
): Promise<WbCredential> {
  if (credential.refreshToken === '') throw new ApiError('auth', 'workbuddy credential has no refresh token; sign in again in the WorkBuddy app')
  let res: Response
  try {
    res = await fetchFn(`${chatBase(credential)}/v2/plugin/auth/token/refresh`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'x-refresh-token': credential.refreshToken,
        'x-auth-refresh-source': 'workbuddy',
        'user-agent': CLIENT_UA,
      },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (cause) {
    throw new ApiError('network', `workbuddy token refresh failed: ${String(cause)}`)
  }
  const envelope = await readEnvelope(res)
  if (!res.ok || envelope.code !== 0) {
    throw new ApiError('auth', `workbuddy token refresh failed (HTTP ${res.status} code ${envelope.code})`)
  }
  const data = (envelope.data ?? {}) as Record<string, unknown>
  const accessToken = typeof data['accessToken'] === 'string' ? data['accessToken'] : ''
  if (accessToken === '') throw new ApiError('auth', 'workbuddy token refresh returned no accessToken')
  const refreshed: WbCredential = {
    ...credential,
    accessToken,
    ...(typeof data['refreshToken'] === 'string' && data['refreshToken'] !== '' ? { refreshToken: data['refreshToken'] as string } : {}),
    ...(typeof data['expiresIn'] === 'number' && data['expiresIn'] > 0
      ? { expiresAtMs: Date.now() + data['expiresIn'] * 1000 }
      : {}),
  }
  await persistRefreshedCredential(refreshed)
  return refreshed
}

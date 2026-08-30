/**
 * TRAE check-in credits API client, modeled on dsh-trae-connect's credential
 * path (the sanctioned integration this plugin defers to).
 *
 * Credential: the desktop app's `x-ide-token` (the same value the web console
 * stores as `Cloud-IDE-Token`). Sources, latest expiry winning:
 *   1. a manually pasted token (plugin settings; explicit user choice),
 *   2. the bridge export `<appDir>/trae-auth.json` (written by
 *      dsh-trae-connect's capture tool),
 *   3. dsh-trae-connect's plugin-owned copy `~/.dsh/.trae-auth.json`
 *      (read-only; kept fresh by its refresh scheduler),
 *   4. this plugin's own copy under its store dir (refreshes we perform).
 *
 * Refresh: the two-step OAuth ExchangeToken on api.trae.cn rotates the
 * refresh token and mints a fresh ideToken, persisted to our own copy.
 * Both endpoints here authenticate with `Authorization: Cloud-IDE-JWT` plus
 * the x-device-id header (NOT Bearer).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ApiError } from './errors.ts'
import { storeDir } from './store.ts'

/** Fetch implementation seam (tests swap global fetch out). */
export type FetchFn = typeof fetch

const TRAE_BASE = 'https://api.trae.cn'
/** Public CN OAuth client id (not a secret; required by the ExchangeToken path). */
const CN_CLIENT_ID = 'ono9krqynydwx5'
/** Fallback device id when the credential carries no device block. */
const FALLBACK_DEVICE_ID = 'dsh-points-checkin'

const STATUS_PATH = '/trae/api/v2/ug/checkin_credits/status'
const CLAIM_PATH = '/trae/api/v2/ug/checkin_credits/claim'
const ENTITLEMENTS_PATH = '/trae/api/v2/pay/user_current_entitlement_list'
const EXCHANGE_PATH = '/cloudide/api/v3/trae/oauth/ExchangeToken'

/** Resolved TRAE credential. */
export interface TraeCredential {
  ideToken: string
  appId: string
  clientId: string
  userId: string
  refreshToken?: string
  expiresAtMs: number
  device: { deviceId: string; deviceBrand?: string; deviceType?: string }
  source: 'manual' | 'trae-desktop' | 'dsh' | 'points-checkin'
}

/** Normalize an expiry that may arrive in seconds or milliseconds. */
function expiryToMs(value: number): number {
  if (value <= 0) return 0
  return value > 0xe8d4a51000 ? value : value * 1e3
}

/** Read the real expiry out of the ideToken JWT's exp claim. */
export function ideTokenExpiryMs(ideToken: string): number {
  try {
    const payload = ideToken.split('.')[1]
    if (!payload) return 0
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
    const exp = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')).exp
    return typeof exp === 'number' ? expiryToMs(exp) : 0
  } catch {
    return 0
  }
}

function randomDeviceId(): string {
  return String(Math.floor(Math.random() * 9e15) + 0x38d7ea4c68000)
}

/**
 * Parse a TRAE auth document: either the bridge export shape
 * `{ideToken, appId, clientId?, userId?, refreshToken?, expiresAt?, device?}`
 * or the plugin-owned-copy shape `{version:1, credential:{...}}`.
 */
export function parseTraeAuth(text: string, source: TraeCredential['source']): TraeCredential | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const doc = parsed as Record<string, unknown>
  const inner = (typeof doc['credential'] === 'object' && doc['credential'] !== null
    ? doc['credential']
    : doc) as Record<string, unknown>
  const ideToken = typeof inner['ideToken'] === 'string' ? (inner['ideToken'] as string) : ''
  if (ideToken === '') return undefined
  const rawDevice = (typeof inner['device'] === 'object' && inner['device'] !== null
    ? inner['device']
    : {}) as Record<string, unknown>
  const device: TraeCredential['device'] = {
    deviceId: typeof rawDevice['deviceId'] === 'string' && rawDevice['deviceId'] !== ''
      ? (rawDevice['deviceId'] as string)
      : randomDeviceId(),
    ...(typeof rawDevice['deviceBrand'] === 'string' ? { deviceBrand: rawDevice['deviceBrand'] as string } : {}),
    ...(typeof rawDevice['deviceType'] === 'string' ? { deviceType: rawDevice['deviceType'] as string } : {}),
  }
  const expiresAtMs = typeof inner['expiresAt'] === 'number'
    ? expiryToMs(inner['expiresAt'] as number)
    : typeof inner['tokenExpiresAtMs'] === 'number' && (inner['tokenExpiresAtMs'] as number) > 0
      ? expiryToMs(inner['tokenExpiresAtMs'] as number)
      : ideTokenExpiryMs(ideToken)
  return {
    ideToken,
    appId: typeof inner['appId'] === 'string' ? (inner['appId'] as string) : '',
    clientId: typeof inner['clientId'] === 'string' ? (inner['clientId'] as string) : '',
    userId: typeof inner['userId'] === 'string' ? (inner['userId'] as string) : '',
    ...(typeof inner['refreshToken'] === 'string' && (inner['refreshToken'] as string) !== ''
      ? { refreshToken: inner['refreshToken'] as string }
      : {}),
    expiresAtMs,
    device,
    source,
  }
}

/** Desktop app-dir candidates (probe order; mirrors dsh-trae-connect). */
export function traeAppDirCandidates(): string[] {
  const home = homedir()
  const fromEnv = process.env.TRAE_APP_DIR?.trim()
  if (fromEnv) return [fromEnv]
  if (process.platform === 'darwin') {
    const base = join(home, 'Library', 'Application Support')
    return [join(base, 'TRAE SOLO CN'), join(base, 'Trae')]
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    return [join(base, 'TRAE SOLO CN'), join(base, 'Trae')]
  }
  const base = join(home, '.config')
  return [join(base, 'TRAE SOLO CN'), join(base, 'Trae')]
}

/** dsh-trae-connect's plugin-owned copy (read-only for us). */
function traeConnectOwnPath(): string {
  return join(homedir(), '.dsh', '.trae-auth.json')
}

/** This plugin's own refreshed-token copy. */
function ownCopyPath(): string {
  return join(storeDir(), 'trae-auth-copy.json')
}

/** Later non-zero expiry wins. */
function laterExpiry(a: TraeCredential, b: TraeCredential): TraeCredential {
  return (b.expiresAtMs || 0) > (a.expiresAtMs || 0) ? b : a
}

/**
 * Best available credential. The manual token participates in the same
 * latest-expiry comparison as the file sources, so a stale pasted token
 * automatically yields to a fresher desktop capture instead of blocking it.
 */
export async function resolveTraeCredential(manualToken?: string): Promise<TraeCredential | undefined> {
  let credential: TraeCredential | undefined
  if (manualToken) {
    credential = {
      ideToken: manualToken,
      appId: '',
      clientId: '',
      userId: '',
      expiresAtMs: ideTokenExpiryMs(manualToken),
      device: { deviceId: FALLBACK_DEVICE_ID },
      source: 'manual',
    }
  }
  const candidates: Array<[string, TraeCredential['source']]> = [
    ...traeAppDirCandidates().map((dir) => [join(dir, 'trae-auth.json'), 'trae-desktop' as const] as [string, TraeCredential['source']]),
    [traeConnectOwnPath(), 'dsh' as const],
    [ownCopyPath(), 'points-checkin' as const],
  ]
  for (const [path, source] of candidates) {
    try {
      const parsed = parseTraeAuth(await readFile(path, 'utf8'), source)
      if (!parsed) continue
      credential = credential ? laterExpiry(credential, parsed) : parsed
    } catch {
      // Missing/unreadable candidate: try the next one.
    }
  }
  return credential
}

/** Persist a refreshed credential to this plugin's own copy (0600). */
export async function persistTraeCredential(credential: TraeCredential): Promise<void> {
  await writeFile(ownCopyPath(), JSON.stringify({ version: 1, credential }, null, 2), { mode: 0o600 })
}

function headers(credential: TraeCredential): Record<string, string> {
  const out: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Cloud-IDE-JWT ${credential.ideToken}`,
    'x-device-id': credential.device.deviceId || FALLBACK_DEVICE_ID,
  }
  if (credential.device.deviceBrand) out['x-device-brand'] = credential.device.deviceBrand
  if (credential.device.deviceType) out['x-device-type'] = credential.device.deviceType
  return out
}

interface TraeResponse {
  code?: number
  message?: string
  enable?: unknown
  checked_in?: unknown
  credits?: unknown
  data?: Record<string, unknown>
}

/** Whether an HTTP status / business code means "the ideToken is dead". */
export function isAuthFailure(code: number | undefined, http: number): boolean {
  return http === 401 || http === 403 || code === 1001
}

async function post(
  path: string,
  credential: TraeCredential,
  fetchFn: FetchFn,
): Promise<TraeResponse> {
  let res: Response
  try {
    res = await fetchFn(`${TRAE_BASE}${path}`, {
      method: 'POST',
      headers: headers(credential),
      body: '{}',
      signal: AbortSignal.timeout(30_000),
    })
  } catch (cause) {
    throw new ApiError('network', `trae ${path} request failed: ${String(cause)}`)
  }
  let body: TraeResponse
  try {
    body = (await res.json()) as TraeResponse
  } catch {
    if (!res.ok) throw new ApiError('network', `trae ${path} returned HTTP ${res.status}`)
    throw new ApiError('protocol', `trae ${path} returned a non-JSON body`)
  }
  const code = typeof body.code === 'number' ? body.code : undefined
  if (isAuthFailure(code, res.status)) {
    throw new ApiError('auth', `trae ${path} rejected the credential (HTTP ${res.status} code ${code})`)
  }
  if (!res.ok) throw new ApiError('network', `trae ${path} returned HTTP ${res.status}`)
  if (code !== undefined && code !== 0) {
    throw new ApiError('business', `trae ${path} business error ${code}: ${body.message ?? ''}`, code)
  }
  return body
}

function flat(body: TraeResponse): Record<string, unknown> {
  return (body.data ?? body) as Record<string, unknown>
}

/** Normalized status payload from /checkin_credits/status. */
export interface TraeStatus {
  enable: boolean
  checkedIn: boolean
  /** Check-in sub-wallet balance (NOT the account total). */
  credits?: number
}

/** Query the daily check-in status. */
export async function traeStatus(
  credential: TraeCredential,
  fetchFn: FetchFn = fetch,
): Promise<TraeStatus> {
  const flatBody = flat(await post(STATUS_PATH, credential, fetchFn))
  if (typeof flatBody.enable !== 'boolean' || typeof flatBody.checked_in !== 'boolean') {
    throw new ApiError('protocol', 'trae status body missed enable/checked_in')
  }
  const credits = typeof flatBody.credits === 'number' ? flatBody.credits : undefined
  return { enable: flatBody.enable, checkedIn: flatBody.checked_in, credits }
}

/** Claim today's check-in credits. */
export async function traeClaim(
  credential: TraeCredential,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  await post(CLAIM_PATH, credential, fetchFn)
}

/** Remaining total from the credits ledger (usage_summary.total - consumed). */
export interface TraeEntitlements {
  remaining: number
  totalAmount: number
  consumedAmount: number
}

/**
 * Query the credits ledger — the dashboard's own source for 总可用积分.
 * checkin_credits/status's `credits` field is only the check-in sub-wallet.
 */
export async function traeEntitlements(
  credential: TraeCredential,
  fetchFn: FetchFn = fetch,
): Promise<TraeEntitlements> {
  const body = flat(await post(ENTITLEMENTS_PATH, credential, fetchFn))
  const summary = (body['usage_summary'] ?? {}) as Record<string, unknown>
  const total = typeof summary['total_amount'] === 'number' ? (summary['total_amount'] as number) : NaN
  const consumed = typeof summary['consumed_amount'] === 'number' ? (summary['consumed_amount'] as number) : NaN
  if (Number.isNaN(total) || Number.isNaN(consumed)) {
    throw new ApiError('protocol', 'trae entitlement list missed usage_summary amounts')
  }
  const remaining = Math.max(0, Math.round((total - consumed) * 100) / 100)
  return { remaining, totalAmount: total, consumedAmount: consumed }
}

/**
 * Two-step OAuth exchange: refreshToken -> rotated refreshToken -> ideToken.
 * The result is persisted to this plugin's own copy so it wins on next resolve.
 */
export async function traeRefresh(
  credential: TraeCredential,
  fetchFn: FetchFn = fetch,
): Promise<TraeCredential> {
  const clientId = credential.clientId || CN_CLIENT_ID
  if (!credential.refreshToken || !credential.userId) {
    throw new ApiError('auth', 'trae credential has no refresh token/user id; re-capture from the desktop app')
  }
  const exchange = async (refreshToken: string): Promise<{ Token?: string; TokenExpireAt?: number; RefreshToken?: string }> => {
    let res: Response
    try {
      res = await fetchFn(`${TRAE_BASE}${EXCHANGE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ClientID: clientId,
          RefreshToken: refreshToken,
          ClientSecret: '-',
          UserID: credential.userId,
        }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (cause) {
      throw new ApiError('network', `trae token exchange failed: ${String(cause)}`)
    }
    if (!res.ok) {
      throw new ApiError('auth', `trae token exchange failed (HTTP ${res.status})`)
    }
    const json = (await res.json().catch(() => ({}))) as { Result?: { Token?: string; TokenExpireAt?: number; RefreshToken?: string } }
    if (!json.Result?.Token) throw new ApiError('auth', 'trae token exchange returned no Token')
    return json.Result
  }
  const first = await exchange(credential.refreshToken)
  const second = await exchange(first.RefreshToken ?? credential.refreshToken)
  const refreshed: TraeCredential = {
    ...credential,
    ideToken: second.Token ?? first.Token ?? credential.ideToken,
    expiresAtMs: second.TokenExpireAt ?? first.TokenExpireAt ?? 0,
    refreshToken: second.RefreshToken ?? first.RefreshToken ?? credential.refreshToken,
    source: 'points-checkin',
  }
  await persistTraeCredential(refreshed)
  return refreshed
}

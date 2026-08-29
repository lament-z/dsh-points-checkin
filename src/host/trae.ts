/**
 * TRAE check-in credits API client (reverse-engineered from the TRAE SOLO CN
 * 2.3.78099 bundle; see .scratch/points-checkin/spec.md).
 *
 * Base: https://api.trae.cn. Both endpoints are POST with an empty JSON body;
 * auth is `Authorization: Cloud-IDE-JWT <token>` plus the device headers the
 * client attaches. Response bodies are flat: {code, enable, checked_in,
 * credits} for status.
 */
import { ApiError } from './errors.ts'

/** TRAE ugApi base for the CN environment (product.json bootConfig.ug.trae.normal). */
export const TRAE_BASE = 'https://api.trae.cn'

const STATUS_PATH = '/trae/api/v2/ug/checkin_credits/status'
const CLAIM_PATH = '/trae/api/v2/ug/checkin_credits/claim'

/** Normalized status payload from /checkin_credits/status. */
export interface TraeStatus {
  /** Whether the check-in campaign is enabled for this account. */
  enable: boolean
  /** Whether today's credit drop is already claimed. */
  checkedIn: boolean
  /** Current credit balance, when the status response carries one. */
  credits?: number
}

/** Fetch implementation seam (tests swap global fetch out). */
export type FetchFn = typeof fetch

interface TraeResponse {
  code?: number
  message?: string
  enable?: unknown
  checked_in?: unknown
  credits?: unknown
  data?: Record<string, unknown>
}

function headers(token: string, deviceId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Cloud-IDE-JWT ${token}`,
    'x-device-id': deviceId,
  }
}

async function post(
  path: string,
  token: string,
  deviceId: string,
  fetchFn: FetchFn,
): Promise<TraeResponse> {
  let res: Response
  try {
    res = await fetchFn(`${TRAE_BASE}${path}`, {
      method: 'POST',
      headers: headers(token, deviceId),
      body: '{}',
    })
  } catch (cause) {
    throw new ApiError('network', `trae ${path} request failed: ${String(cause)}`)
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiError('auth', `trae ${path} rejected the token (HTTP ${res.status})`)
  }
  if (!res.ok) {
    throw new ApiError('network', `trae ${path} returned HTTP ${res.status}`)
  }
  let body: TraeResponse
  try {
    body = (await res.json()) as TraeResponse
  } catch {
    throw new ApiError('protocol', `trae ${path} returned a non-JSON body`)
  }
  if (typeof body.code === 'number' && body.code !== 0) {
    throw new ApiError('business', `trae ${path} business error ${body.code}: ${body.message ?? ''}`, body.code)
  }
  return body
}

/** Flatten {code, data:{...}} and flat {code, enable, ...} shapes alike. */
function flat(body: TraeResponse): Record<string, unknown> {
  return (body.data ?? body) as Record<string, unknown>
}

/** Query the daily check-in status (and current credits when present). */
export async function traeStatus(
  token: string,
  deviceId: string,
  fetchFn: FetchFn = fetch,
): Promise<TraeStatus> {
  const flatBody = flat(await post(STATUS_PATH, token, deviceId, fetchFn))
  if (typeof flatBody.enable !== 'boolean' || typeof flatBody.checked_in !== 'boolean') {
    throw new ApiError('protocol', 'trae status body missed enable/checked_in')
  }
  const credits = typeof flatBody.credits === 'number' ? flatBody.credits : undefined
  return { enable: flatBody.enable, checkedIn: flatBody.checked_in, credits }
}

/** Claim today's check-in credits. */
export async function traeClaim(
  token: string,
  deviceId: string,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  await post(CLAIM_PATH, token, deviceId, fetchFn)
}

const ENTITLEMENTS_PATH = '/trae/api/v2/pay/user_current_entitlement_list'

/** Remaining total from the credits ledger (usage_summary.total - consumed). */
export interface TraeEntitlements {
  remaining: number
  totalAmount: number
  consumedAmount: number
}

/**
 * Query the credits ledger — the dashboard's own source for 总可用积分.
 * checkin_credits/status's `credits` field is only the check-in sub-wallet,
 * not the account total.
 */
export async function traeEntitlements(
  token: string,
  deviceId: string,
  fetchFn: FetchFn = fetch,
): Promise<TraeEntitlements> {
  const body = flat(await post(ENTITLEMENTS_PATH, token, deviceId, fetchFn))
  const summary = (body['usage_summary'] ?? {}) as Record<string, unknown>
  const total = typeof summary['total_amount'] === 'number' ? (summary['total_amount'] as number) : NaN
  const consumed = typeof summary['consumed_amount'] === 'number' ? (summary['consumed_amount'] as number) : NaN
  if (Number.isNaN(total) || Number.isNaN(consumed)) {
    throw new ApiError('protocol', 'trae entitlement list missed usage_summary amounts')
  }
  const remaining = Math.max(0, Math.round((total - consumed) * 100) / 100)
  return { remaining, totalAmount: total, consumedAmount: consumed }
}

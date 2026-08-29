/**
 * WorkBuddy (CodeBuddy) meter API client (reverse-engineered from the
 * WorkBuddy.app 5.3.14 asar; see .scratch/points-checkin/spec.md).
 *
 * Base: https://www.codebuddy.cn (highest-confidence meter host; confirm on
 * first live run). Endpoints are POSTs with JSON bodies; auth is
 * `Authorization: Bearer <token>` plus the account headers the renderer's
 * AccountService injects. Response shape: {code, data, msg, requestId}.
 */
import { ApiError } from './errors.ts'
import type { FetchFn } from './trae.ts'

/** Meter base (spec open item 1: confirm against a live capture). */
export const WORKBUDDY_BASE = 'https://www.codebuddy.cn'

const STATUS_PATH = '/billing/meter/checkin-status'
const CLAIM_PATH = '/billing/meter/daily-checkin'
const RESOURCE_PATH = '/billing/meter/get-user-resource'

interface MeterResponse {
  code?: number
  msg?: string
  data?: unknown
}

export interface WorkbuddyHeaders {
  token: string
  userId?: string
}

async function post(
  path: string,
  account: WorkbuddyHeaders,
  body: Record<string, unknown>,
  fetchFn: FetchFn,
): Promise<unknown> {
  const requestHeaders: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${account.token}`,
  }
  if (account.userId) requestHeaders['x-user-id'] = account.userId
  let res: Response
  try {
    res = await fetchFn(`${WORKBUDDY_BASE}${path}`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
    })
  } catch (cause) {
    throw new ApiError('network', `workbuddy ${path} request failed: ${String(cause)}`)
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiError('auth', `workbuddy ${path} rejected the token (HTTP ${res.status})`)
  }
  if (!res.ok) {
    throw new ApiError('network', `workbuddy ${path} returned HTTP ${res.status}`)
  }
  let bodyJson: MeterResponse
  try {
    bodyJson = (await res.json()) as MeterResponse
  } catch {
    throw new ApiError('protocol', `workbuddy ${path} returned a non-JSON body`)
  }
  if (typeof bodyJson.code === 'number' && bodyJson.code !== 0) {
    throw new ApiError('business', `workbuddy ${path} business error ${bodyJson.code}: ${bodyJson.msg ?? ''}`, bodyJson.code)
  }
  return bodyJson.data ?? bodyJson
}

/**
 * Query the daily check-in status. The data envelope is opaque to static
 * analysis, so the parser below accepts both a direct boolean and common
 * wrapper shapes; unknown shapes surface as a protocol error.
 */
export interface WorkbuddyStatus {
  checkedIn: boolean
  /** Present when the status payload carries a balance the parser recognizes. */
  points?: number
}

function pickNumber(value: unknown, depth = 0): number | undefined {
  if (depth > 3 || value == null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const [key, field] of Object.entries(record)) {
    if (/credit|point|balance|remain|quota/i.test(key) && typeof field === 'number') return field
  }
  for (const field of Object.values(record)) {
    const found = pickNumber(field, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

function parseCheckedIn(value: unknown): boolean {
  const record = value as Record<string, unknown> | null
  if (record == null || typeof record !== 'object') return false
  for (const [key, field] of Object.entries(record)) {
    if (/checked|signed|is_check|today/i.test(key) && typeof field === 'boolean') return field
  }
  return false
}

/** Query the daily check-in status for the configured account. */
export async function workbuddyStatus(
  account: WorkbuddyHeaders,
  fetchFn: FetchFn = fetch,
): Promise<WorkbuddyStatus> {
  const data = await post(STATUS_PATH, account, {}, fetchFn)
  if (typeof data !== 'object' || data == null) {
    throw new ApiError('protocol', 'workbuddy checkin-status returned an unexpected shape')
  }
  return { checkedIn: parseCheckedIn(data), points: pickNumber(data) }
}

/** Claim today's check-in reward. */
export async function workbuddyClaim(
  account: WorkbuddyHeaders,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  await post(CLAIM_PATH, account, {}, fetchFn)
}

/**
 * Query the plan/resource snapshot (spec: get-user-resource with the
 * p_tcaca product code). The exact balance field is an open item; the raw
 * data is surfaced to the client for display heuristics.
 */
export async function workbuddyResource(
  account: WorkbuddyHeaders,
  fetchFn: FetchFn = fetch,
): Promise<unknown> {
  const body = {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: 'p_tcaca',
    Status: [1, 2],
  }
  return post(RESOURCE_PATH, account, body, fetchFn)
}

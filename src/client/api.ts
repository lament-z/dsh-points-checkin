/**
 * Browser-side client for the host bridge. The port is discovered by probing
 * a short fixed range for /ping (see host/bridge.ts); the working port is
 * cached for the page session.
 */

/** Ports the host bridge may be listening on, in probe order. */
const PORT_CANDIDATES = [27182, 27183, 27184, 27185, 27186, 27187, 27188, 27189, 27190, 27191]

const PROBE_TIMEOUT_MS = 800
const REQUEST_TIMEOUT_MS = 15_000

/** Mirror of host/store.ts shapes the panel renders. */
export interface ServiceSnapshot {
  service: 'trae' | 'workbuddy'
  configured: boolean
  authOk: boolean | null
  checkedIn: boolean | null
  checkinEnabled: boolean | null
  points: number | null
  pointsRaw?: unknown
  lastCheckin: string | null
  error?: 'auth' | 'network' | 'protocol' | 'business'
  errorMessage?: string
}

export interface Snapshot {
  trae: ServiceSnapshot
  workbuddy: ServiceSnapshot
}

export interface CredentialsView {
  trae: { configured: boolean; token: string; deviceId: string }
  workbuddy: { configured: boolean; token: string; userId: string }
}

export interface CredentialsPatch {
  trae?: { token?: string; deviceId?: string }
  workbuddy?: { token?: string; userId?: string }
}

/** Unreachable bridge (no candidate port answered). */
export class BridgeUnreachableError extends Error {
  constructor() {
    super('bridge unreachable')
    this.name = 'BridgeUnreachableError'
  }
}

let cachedPort: number | null = null
let probing: Promise<number | null> | null = null

async function probeOnce(): Promise<number | null> {
  for (const port of PORT_CANDIDATES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ping`, { signal: controller.signal })
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean; plugin?: string }
        if (body.ok && body.plugin === 'points-checkin') return port
      }
    } catch {
      // Try the next candidate.
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/** Probe rounds (the host may still be booting when the panel mounts). */
const PROBE_ROUNDS = 3
const PROBE_ROUND_DELAY_MS = 700

async function probe(): Promise<number | null> {
  for (let round = 0; round < PROBE_ROUNDS; round += 1) {
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, PROBE_ROUND_DELAY_MS))
    const found = await probeOnce()
    if (found !== null) return found
  }
  return null
}

/** Resolve the bridge port, probing once per page session. */
export async function bridgePort(): Promise<number | null> {
  if (cachedPort !== null) return cachedPort
  if (!probing) {
    probing = probe().finally(() => {
      probing = null
    })
  }
  const found = await probing
  if (found === null) return null
  cachedPort = found
  return found
}

/** Forget the cached port (call after connection failures). */
export function resetBridgePort(): void {
  cachedPort = null
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const port = await bridgePort()
  if (port === null) throw new BridgeUnreachableError()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; kind?: string }
      const error = new Error(body.error ?? `bridge returned HTTP ${res.status}`)
      ;(error as Error & { kind?: string }).kind = body.kind
      throw error
    }
    return (await res.json()) as T
  } catch (cause) {
    if (cause instanceof TypeError) {
      // A network-level failure usually means the host went away: reprobe.
      resetBridgePort()
    }
    throw cause
  } finally {
    clearTimeout(timer)
  }
}

/** Fetch the full snapshot (pass refresh to force upstream probes). */
export function fetchState(refresh = false): Promise<Snapshot> {
  return call<Snapshot>(`/state${refresh ? '?refresh=1' : ''}`)
}

/** Claim one service's daily reward, then the refreshed snapshot. */
export function checkin(service: 'trae' | 'workbuddy'): Promise<Snapshot> {
  return call<Snapshot>(`/checkin/${service}`, { method: 'POST' })
}

/** Run the host-side startup catch-up immediately. */
export function refreshAll(): Promise<Snapshot> {
  return call<Snapshot>('/refresh', { method: 'POST' })
}

/** Load the stored credentials (values included; localhost-only bridge). */
export function fetchCredentials(): Promise<CredentialsView> {
  return call<CredentialsView>('/credentials')
}

/** Save a credentials patch, returning the refreshed snapshot. */
export function saveCredentials(patch: CredentialsPatch): Promise<Snapshot> {
  return call<Snapshot>('/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

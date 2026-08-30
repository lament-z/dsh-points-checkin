/**
 * Browser-side client for the host bridge. The port is discovered by probing
 * a short fixed range for /ping (see host/bridge.ts); the working port is
 * cached for the page session.
 */

/** Ports the host bridge may be listening on, in probe order. */
const PORT_CANDIDATES = [27182, 27183, 27184, 27185, 27186, 27187, 27188, 27189, 27190, 27191]

/**
 * Same-origin gateway prefix. When the panel is served through the public
 * gateway (dsh-bridge-gateway), host APIs are reverse-proxied under this path
 * so the browser can reach them over HTTPS without mixed-content/loopback
 * restrictions. Probed before the raw localhost ports.
 */
const GATEWAY_PREFIX = '/points-checkin'

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
  /** WorkBuddy only: where the credential came from. */
  credentialSource?: 'desktop' | 'plugin-copy' | 'manual'
  error?: 'auth' | 'network' | 'protocol' | 'business'
  errorMessage?: string
}

export interface Snapshot {
  trae: ServiceSnapshot
  workbuddy: ServiceSnapshot
}

export interface PluginSettingsView {
  checkinTime: string
}

/** Unreachable bridge (no candidate port answered). */
export class BridgeUnreachableError extends Error {
  constructor() {
    super('bridge unreachable')
    this.name = 'BridgeUnreachableError'
  }
}

/** Resolved bridge transport for this page session. */
type BridgeTarget = { mode: 'gateway' } | { mode: 'localhost'; port: number }

let cachedTarget: BridgeTarget | null = null
let probing: Promise<BridgeTarget | null> | null = null

/** Probe the same-origin gateway proxy path (reverse-proxied host bridge). */
async function probeGateway(): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_PREFIX}/ping`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (res.ok) {
      const body = (await res.json()) as { ok?: boolean; plugin?: string }
      return body.ok === true && body.plugin === 'points-checkin'
    }
  } catch {
    // Not behind the gateway; fall through to the localhost probe.
  }
  return false
}

async function probeOnce(): Promise<BridgeTarget | null> {
  if (await probeGateway()) return { mode: 'gateway' }
  for (const port of PORT_CANDIDATES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ping`, { signal: controller.signal })
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean; plugin?: string }
        if (body.ok && body.plugin === 'points-checkin') return { mode: 'localhost', port }
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

async function probe(): Promise<BridgeTarget | null> {
  for (let round = 0; round < PROBE_ROUNDS; round += 1) {
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, PROBE_ROUND_DELAY_MS))
    const found = await probeOnce()
    if (found !== null) return found
  }
  return null
}

/** Resolve the bridge transport, probing once per page session. */
export async function bridgeTarget(): Promise<BridgeTarget | null> {
  if (cachedTarget !== null) return cachedTarget
  if (!probing) {
    probing = probe().finally(() => {
      probing = null
    })
  }
  const found = await probing
  if (found === null) return null
  cachedTarget = found
  return found
}

/** Forget the resolved transport (call after connection failures). */
export function resetBridgeTarget(): void {
  cachedTarget = null
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const target = await bridgeTarget()
  if (target === null) throw new BridgeUnreachableError()
  const url = target.mode === 'gateway' ? `${GATEWAY_PREFIX}${path}` : `http://127.0.0.1:${target.port}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
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
      resetBridgeTarget()
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

/** Load the plugin settings (the daily check-in schedule). */
export function fetchSettings(): Promise<PluginSettingsView> {
  return call<PluginSettingsView>('/settings')
}

/** Save the daily check-in schedule. */
export function saveCheckinTime(checkinTime: string): Promise<PluginSettingsView> {
  return call<PluginSettingsView>('/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checkinTime }),
  })
}

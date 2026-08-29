/**
 * Check-in orchestrator: a per-service snapshot for the client panel, manual
 * claim, and the startup catch-up (ensureToday) that claims any configured
 * service whose local date has not been checked in yet.
 */
import { ApiError } from './errors.ts'
import * as trae from './trae.ts'
import * as workbuddy from './workbuddy.ts'
import type { WbCredential } from './workbuddy.ts'
import {
  readCredentials,
  readState,
  todayLocal,
  writeCredentials,
  writeState,
  type Credentials,
} from './store.ts'
/** All services the plugin knows. */
export type ServiceName = 'trae' | 'workbuddy'
export const SERVICES: readonly ServiceName[] = ['trae', 'workbuddy'] as const

/** Client-facing per-service view. */
export interface ServiceSnapshot {
  service: ServiceName
  /** Whether credentials are configured at all. */
  configured: boolean
  /** null = not probed yet (or not configured). */
  authOk: boolean | null
  checkedIn: boolean | null
  /** Whether the daily campaign is enabled upstream (TRAE reports this). */
  checkinEnabled: boolean | null
  /** Numeric balance when the upstream payload carries a recognizable one. */
  points: number | null
  /** Raw upstream data for the panel's fallback display. */
  pointsRaw?: unknown
  /** Local date of the last successful claim. */
  lastCheckin: string | null
  /** Stable error kind of the last probe/claim, when one stands. */
  error?: 'auth' | 'network' | 'protocol' | 'business'
  /** Human-readable error message of the last probe/claim. */
  errorMessage?: string
  /** WorkBuddy only: where the credential came from (desktop file or manual). */
  credentialSource?: 'desktop' | 'plugin-copy' | 'manual'
}

/** Full client-facing state. */
export interface Snapshot {
  trae: ServiceSnapshot
  workbuddy: ServiceSnapshot
}

/** Upstream API seams (tests swap these). */
export interface ApiAdapters {
  trae: {
    status: typeof trae.traeStatus
    entitlements: typeof trae.traeEntitlements
    claim: typeof trae.traeClaim
  }
  workbuddy: {
    /** Resolve the effective credential (manual token wins; else desktop file + plugin copy). */
    resolve: (manualToken?: string) => Promise<WbCredential | undefined>
    status: typeof workbuddy.workbuddyStatus
    points: typeof workbuddy.workbuddyPoints
    claim: typeof workbuddy.workbuddyClaim
    refresh: typeof workbuddy.workbuddyRefresh
  }
}

/** Default adapters over the real API clients. */
export function defaultApis(): ApiAdapters {
  return {
    trae: { status: trae.traeStatus, entitlements: trae.traeEntitlements, claim: trae.traeClaim },
    workbuddy: {
      resolve: (manualToken) => workbuddy.resolveStoredCredential(manualToken),
      status: workbuddy.workbuddyStatus,
      points: workbuddy.workbuddyPoints,
      claim: workbuddy.workbuddyClaim,
      refresh: workbuddy.workbuddyRefresh,
    },
  }
}

const SNAPSHOT_TTL_MS = 30_000

/** Per-service runtime view (credentials + last probe + last error). */
interface RuntimeService {
  credentials: Credentials['trae'] & Credentials['workbuddy']
  /** Last resolved WorkBuddy credential (workbuddy only). */
  resolved?: WbCredential
  lastCheckin: string | null
  authOk: boolean | null
  checkedIn: boolean | null
  checkinEnabled: boolean | null
  points: number | null
  pointsRaw?: unknown
  error?: ServiceSnapshot['error']
  errorMessage?: string
  probedAt: number
}

function emptyRuntime(credentials: Credentials['trae'] & Credentials['workbuddy'], lastCheckin: string | null): RuntimeService {
  return {
    credentials,
    lastCheckin,
    authOk: null,
    checkedIn: null,
    checkinEnabled: null,
    points: null,
    probedAt: 0,
  }
}

export class CheckinOrchestrator {
  private readonly apis: ApiAdapters
  private readonly runtime: Record<ServiceName, RuntimeService>
  private readonly refreshing: Record<ServiceName, Promise<void> | undefined> = { trae: undefined, workbuddy: undefined }

  constructor(apis: ApiAdapters = defaultApis()) {
    this.apis = apis
    this.runtime = {
      trae: emptyRuntime(undefined, null),
      workbuddy: emptyRuntime(undefined, null),
    }
  }

  /** (Re)load credentials and state from disk. */
  async reload(): Promise<void> {
    const [credentials, state] = [await readCredentials(), await readState()]
    this.runtime.trae = emptyRuntime(credentials.trae, state.trae?.lastCheckin ?? null)
    this.runtime.workbuddy = emptyRuntime(credentials.workbuddy, state.workbuddy?.lastCheckin ?? null)
  }

  /** Merge a credentials patch (per service) and persist it. */
  async setCredentials(patch: {
    trae?: { token?: string; deviceId?: string }
    workbuddy?: { token?: string; userId?: string }
  }): Promise<void> {
    const current = await readCredentials()
    if (patch.trae) {
      const token = patch.trae.token ?? current.trae?.token ?? ''
      const deviceId = patch.trae.deviceId ?? current.trae?.deviceId
      if (token) current.trae = deviceId ? { token, deviceId } : { token }
      else delete current.trae
    }
    if (patch.workbuddy) {
      const token = patch.workbuddy.token ?? current.workbuddy?.token ?? ''
      const userId = patch.workbuddy.userId ?? current.workbuddy?.userId
      if (token) current.workbuddy = userId ? { token, userId } : { token }
      else delete current.workbuddy
    }
    await writeCredentials(current)
    await this.reload()
  }

  /** Current client-facing snapshot (probes are cached for SNAPSHOT_TTL_MS). */
  async snapshot(force = false): Promise<Snapshot> {
    await Promise.all(SERVICES.map((service) => this.probe(service, force)))
    return { trae: this.toSnapshot('trae'), workbuddy: this.toSnapshot('workbuddy') }
  }

  /** Claim today's reward for one service; records the date on success. */
  async checkin(service: ServiceName): Promise<void> {
    const runtime = this.runtime[service]
    if (service === 'trae') {
      if (!runtime.credentials?.token) throw new ApiError('auth', 'trae is not configured')
      await this.apis.trae.claim(runtime.credentials.token, runtime.credentials.deviceId ?? '')
    } else {
      const credential = runtime.resolved ?? await this.apis.workbuddy.resolve(runtime.credentials?.token)
      if (!credential) throw new ApiError('auth', 'workbuddy is not configured (desktop app not signed in?)')
      await this.apis.workbuddy.claim(credential)
      runtime.resolved = credential
    }
    runtime.checkedIn = true
    runtime.lastCheckin = todayLocal()
    runtime.error = undefined
    runtime.errorMessage = undefined
    await this.persistState(service)
  }

  /**
   * Startup catch-up: for every configured service, probe; claim when the
   * upstream reports enabled-and-not-checked-in. Errors are recorded on the
   * runtime (surfaced by the panel) and never propagate.
   */
  async ensureToday(): Promise<void> {
    await Promise.all(SERVICES.map((service) => this.ensureTodayOne(service)))
  }

  private async ensureTodayOne(service: ServiceName): Promise<void> {
    if (this.refreshing[service]) return this.refreshing[service]
    const task = (async () => {
      try {
        await this.probe(service, true)
        const runtime = this.runtime[service]
        const configured = service === 'workbuddy'
          ? Boolean(runtime.resolved || runtime.credentials?.token)
          : Boolean(runtime.credentials?.token)
        if (!configured) return
        if (runtime.checkinEnabled === false) return
        if (runtime.checkedIn) return
        await this.checkin(service)
        await this.probe(service, true)
      } catch {
        // ensureToday never throws; the panel shows the recorded error.
      } finally {
        this.refreshing[service] = undefined
      }
    })()
    this.refreshing[service] = task
    return task
  }

  private async probe(service: ServiceName, force: boolean): Promise<void> {
    const runtime = this.runtime[service]
    // A claim that already succeeded today is authoritative even when a
    // follow-up status probe still reports unchecked (upstream lag).
    const claimedToday = runtime.lastCheckin === todayLocal()
    if (service === 'workbuddy') {
      await this.probeWorkbuddy(runtime, force, claimedToday)
      return
    }
    if (!runtime.credentials?.token) return
    const fresh = Date.now() - runtime.probedAt < SNAPSHOT_TTL_MS
    if (fresh && !force) return
    try {
      const status = await this.apis.trae.status(runtime.credentials.token, runtime.credentials.deviceId ?? '')
      runtime.authOk = true
      runtime.checkinEnabled = status.enable
      runtime.checkedIn = status.checkedIn || claimedToday
      // The check-in wallet figure is not the account total; the ledger is.
      try {
        const ledger = await this.apis.trae.entitlements(runtime.credentials.token, runtime.credentials.deviceId ?? '')
        runtime.points = ledger.remaining
        runtime.pointsRaw = ledger
      } catch {
        runtime.points = status.credits ?? null
      }
      runtime.error = undefined
      runtime.errorMessage = undefined
    } catch (cause) {
      this.recordError(runtime, cause)
    } finally {
      runtime.probedAt = Date.now()
    }
  }

  private async probeWorkbuddy(runtime: RuntimeService, force: boolean, claimedToday: boolean): Promise<void> {
    const fresh = Date.now() - runtime.probedAt < SNAPSHOT_TTL_MS
    if (fresh && !force) return
    let credential: WbCredential | undefined
    try {
      credential = (runtime.authOk === true && runtime.resolved) || await this.apis.workbuddy.resolve(runtime.credentials?.token)
      if (!credential) {
        runtime.authOk = null
        return
      }
      // Refresh happens on explicit auth rejection below; expiry timestamps
      // alone are not authoritative (the desktop app may have refreshed).
      let active = credential
      try {
        const [status, accounts] = await Promise.all([
          this.apis.workbuddy.status(active),
          this.apis.workbuddy.points(active),
        ])
        runtime.authOk = true
        runtime.checkedIn = (status.checkedIn ?? false) || claimedToday
        runtime.points = accounts.reduce((sum, entry) => sum + entry.remain, 0)
        runtime.pointsRaw = accounts
        runtime.error = undefined
        runtime.errorMessage = undefined
      } catch (cause) {
        if (cause instanceof ApiError && cause.kind === 'auth' && active.refreshToken !== '') {
          active = await this.apis.workbuddy.refresh(active)
          const [status, accounts] = await Promise.all([
            this.apis.workbuddy.status(active),
            this.apis.workbuddy.points(active),
          ])
          runtime.authOk = true
          runtime.checkedIn = (status.checkedIn ?? false) || claimedToday
          runtime.points = accounts.reduce((sum, entry) => sum + entry.remain, 0)
          runtime.pointsRaw = accounts
          runtime.error = undefined
          runtime.errorMessage = undefined
        } else {
          throw cause
        }
      }
      runtime.resolved = active
    } catch (cause) {
      this.recordError(runtime, cause)
      if (cause instanceof ApiError && cause.kind === 'auth') runtime.authOk = false
    } finally {
      runtime.probedAt = Date.now()
    }
  }

  private recordError(runtime: RuntimeService, cause: unknown): void {
    const apiError = cause instanceof ApiError ? cause : undefined
    runtime.authOk = apiError?.kind === 'auth' ? false : runtime.authOk
    runtime.error = apiError?.kind ?? 'network'
    runtime.errorMessage = cause instanceof Error ? cause.message : String(cause)
  }

  private toSnapshot(service: ServiceName): ServiceSnapshot {
    const runtime = this.runtime[service]
    return {
      service,
      configured: service === 'workbuddy'
        ? Boolean(runtime.resolved || runtime.credentials?.token)
        : Boolean(runtime.credentials?.token),
      authOk: runtime.authOk,
      checkedIn: runtime.checkedIn,
      checkinEnabled: runtime.checkinEnabled,
      points: runtime.points,
      pointsRaw: runtime.pointsRaw,
      lastCheckin: runtime.lastCheckin,
      error: runtime.error,
      errorMessage: runtime.errorMessage,
      ...(service === 'workbuddy' && runtime.resolved ? { credentialSource: runtime.resolved.source } : {}),
    }
  }

  private async persistState(service: ServiceName): Promise<void> {
    const state = await readState()
    state[service] = { lastCheckin: this.runtime[service].lastCheckin ?? undefined }
    await writeState(state)
  }
}

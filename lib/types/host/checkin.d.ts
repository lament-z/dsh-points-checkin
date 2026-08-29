import * as trae from './trae.ts';
import * as workbuddy from './workbuddy.ts';
import type { WbCredential } from './workbuddy.ts';
/** All services the plugin knows. */
export type ServiceName = 'trae' | 'workbuddy';
export declare const SERVICES: readonly ServiceName[];
/** Client-facing per-service view. */
export interface ServiceSnapshot {
    service: ServiceName;
    /** Whether credentials are configured at all. */
    configured: boolean;
    /** null = not probed yet (or not configured). */
    authOk: boolean | null;
    checkedIn: boolean | null;
    /** Whether the daily campaign is enabled upstream (TRAE reports this). */
    checkinEnabled: boolean | null;
    /** Numeric balance when the upstream payload carries a recognizable one. */
    points: number | null;
    /** Raw upstream data for the panel's fallback display. */
    pointsRaw?: unknown;
    /** Local date of the last successful claim. */
    lastCheckin: string | null;
    /** Stable error kind of the last probe/claim, when one stands. */
    error?: 'auth' | 'network' | 'protocol' | 'business';
    /** Human-readable error message of the last probe/claim. */
    errorMessage?: string;
    /** WorkBuddy only: where the credential came from (desktop file or manual). */
    credentialSource?: 'desktop' | 'plugin-copy' | 'manual';
}
/** Full client-facing state. */
export interface Snapshot {
    trae: ServiceSnapshot;
    workbuddy: ServiceSnapshot;
}
/** Upstream API seams (tests swap these). */
export interface ApiAdapters {
    trae: {
        status: typeof trae.traeStatus;
        entitlements: typeof trae.traeEntitlements;
        claim: typeof trae.traeClaim;
    };
    workbuddy: {
        /** Resolve the effective credential (manual token wins; else desktop file + plugin copy). */
        resolve: (manualToken?: string) => Promise<WbCredential | undefined>;
        status: typeof workbuddy.workbuddyStatus;
        points: typeof workbuddy.workbuddyPoints;
        claim: typeof workbuddy.workbuddyClaim;
        refresh: typeof workbuddy.workbuddyRefresh;
    };
}
/** Default adapters over the real API clients. */
export declare function defaultApis(): ApiAdapters;
export declare class CheckinOrchestrator {
    private readonly apis;
    private readonly runtime;
    private readonly refreshing;
    constructor(apis?: ApiAdapters);
    /** (Re)load credentials and state from disk. */
    reload(): Promise<void>;
    /** Merge a credentials patch (per service) and persist it. */
    setCredentials(patch: {
        trae?: {
            token?: string;
            deviceId?: string;
        };
        workbuddy?: {
            token?: string;
            userId?: string;
        };
    }): Promise<void>;
    /** Current client-facing snapshot (probes are cached for SNAPSHOT_TTL_MS). */
    snapshot(force?: boolean): Promise<Snapshot>;
    /** Claim today's reward for one service; records the date on success. */
    checkin(service: ServiceName): Promise<void>;
    /**
     * Startup catch-up: for every configured service, probe; claim when the
     * upstream reports enabled-and-not-checked-in. Errors are recorded on the
     * runtime (surfaced by the panel) and never propagate.
     */
    ensureToday(): Promise<void>;
    private ensureTodayOne;
    private probe;
    private probeWorkbuddy;
    private recordError;
    private toSnapshot;
    private persistState;
}

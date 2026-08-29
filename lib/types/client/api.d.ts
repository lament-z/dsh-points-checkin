/**
 * Browser-side client for the host bridge. The port is discovered by probing
 * a short fixed range for /ping (see host/bridge.ts); the working port is
 * cached for the page session.
 */
/** Mirror of host/store.ts shapes the panel renders. */
export interface ServiceSnapshot {
    service: 'trae' | 'workbuddy';
    configured: boolean;
    authOk: boolean | null;
    checkedIn: boolean | null;
    checkinEnabled: boolean | null;
    points: number | null;
    pointsRaw?: unknown;
    lastCheckin: string | null;
    error?: 'auth' | 'network' | 'protocol' | 'business';
    errorMessage?: string;
}
export interface Snapshot {
    trae: ServiceSnapshot;
    workbuddy: ServiceSnapshot;
}
export interface CredentialsView {
    trae: {
        configured: boolean;
        token: string;
        deviceId: string;
    };
    workbuddy: {
        configured: boolean;
        token: string;
        userId: string;
    };
}
export interface CredentialsPatch {
    trae?: {
        token?: string;
        deviceId?: string;
    };
    workbuddy?: {
        token?: string;
        userId?: string;
    };
}
/** Unreachable bridge (no candidate port answered). */
export declare class BridgeUnreachableError extends Error {
    constructor();
}
/** Resolve the bridge port, probing once per page session. */
export declare function bridgePort(): Promise<number | null>;
/** Forget the cached port (call after connection failures). */
export declare function resetBridgePort(): void;
/** Fetch the full snapshot (pass refresh to force upstream probes). */
export declare function fetchState(refresh?: boolean): Promise<Snapshot>;
/** Claim one service's daily reward, then the refreshed snapshot. */
export declare function checkin(service: 'trae' | 'workbuddy'): Promise<Snapshot>;
/** Run the host-side startup catch-up immediately. */
export declare function refreshAll(): Promise<Snapshot>;
/** Load the stored credentials (values included; localhost-only bridge). */
export declare function fetchCredentials(): Promise<CredentialsView>;
/** Save a credentials patch, returning the refreshed snapshot. */
export declare function saveCredentials(patch: CredentialsPatch): Promise<Snapshot>;

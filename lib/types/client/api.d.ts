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
    /** WorkBuddy only: where the credential came from. */
    credentialSource?: 'desktop' | 'plugin-copy' | 'manual';
    error?: 'auth' | 'network' | 'protocol' | 'business';
    errorMessage?: string;
}
export interface Snapshot {
    trae: ServiceSnapshot;
    workbuddy: ServiceSnapshot;
}
export interface PluginSettingsView {
    checkinTime: string;
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
/** Load the plugin settings (the daily check-in schedule). */
export declare function fetchSettings(): Promise<PluginSettingsView>;
/** Save the daily check-in schedule. */
export declare function saveCheckinTime(checkinTime: string): Promise<PluginSettingsView>;

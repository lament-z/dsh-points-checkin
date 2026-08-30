/** Fetch implementation seam (tests swap global fetch out). */
export type FetchFn = typeof fetch;
/** Resolved TRAE credential. */
export interface TraeCredential {
    ideToken: string;
    appId: string;
    clientId: string;
    userId: string;
    refreshToken?: string;
    expiresAtMs: number;
    device: {
        deviceId: string;
        deviceBrand?: string;
        deviceType?: string;
    };
    source: 'manual' | 'trae-desktop' | 'dsh' | 'points-checkin';
}
/** Read the real expiry out of the ideToken JWT's exp claim. */
export declare function ideTokenExpiryMs(ideToken: string): number;
/**
 * Parse a TRAE auth document: either the bridge export shape
 * `{ideToken, appId, clientId?, userId?, refreshToken?, expiresAt?, device?}`
 * or the plugin-owned-copy shape `{version:1, credential:{...}}`.
 */
export declare function parseTraeAuth(text: string, source: TraeCredential['source']): TraeCredential | undefined;
/** Desktop app-dir candidates (probe order; mirrors dsh-trae-connect). */
export declare function traeAppDirCandidates(): string[];
/**
 * Best available credential. The manual token participates in the same
 * latest-expiry comparison as the file sources, so a stale pasted token
 * automatically yields to a fresher desktop capture instead of blocking it.
 */
export declare function resolveTraeCredential(manualToken?: string): Promise<TraeCredential | undefined>;
/** Persist a refreshed credential to this plugin's own copy (0600). */
export declare function persistTraeCredential(credential: TraeCredential): Promise<void>;
/** Whether an HTTP status / business code means "the ideToken is dead". */
export declare function isAuthFailure(code: number | undefined, http: number): boolean;
/** Normalized status payload from /checkin_credits/status. */
export interface TraeStatus {
    enable: boolean;
    checkedIn: boolean;
    /** Check-in sub-wallet balance (NOT the account total). */
    credits?: number;
}
/** Query the daily check-in status. */
export declare function traeStatus(credential: TraeCredential, fetchFn?: FetchFn): Promise<TraeStatus>;
/** Claim today's check-in credits. */
export declare function traeClaim(credential: TraeCredential, fetchFn?: FetchFn): Promise<void>;
/** Remaining total from the credits ledger (usage_summary.total - consumed). */
export interface TraeEntitlements {
    remaining: number;
    totalAmount: number;
    consumedAmount: number;
}
/**
 * Query the credits ledger — the dashboard's own source for 总可用积分.
 * checkin_credits/status's `credits` field is only the check-in sub-wallet.
 */
export declare function traeEntitlements(credential: TraeCredential, fetchFn?: FetchFn): Promise<TraeEntitlements>;
/**
 * Two-step OAuth exchange: refreshToken -> rotated refreshToken -> ideToken.
 * The result is persisted to this plugin's own copy so it wins on next resolve.
 */
export declare function traeRefresh(credential: TraeCredential, fetchFn?: FetchFn): Promise<TraeCredential>;

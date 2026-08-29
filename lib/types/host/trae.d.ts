/** TRAE ugApi base for the CN environment (product.json bootConfig.ug.trae.normal). */
export declare const TRAE_BASE = "https://api.trae.cn";
/** Normalized status payload from /checkin_credits/status. */
export interface TraeStatus {
    /** Whether the check-in campaign is enabled for this account. */
    enable: boolean;
    /** Whether today's credit drop is already claimed. */
    checkedIn: boolean;
    /** Current credit balance, when the status response carries one. */
    credits?: number;
}
/** Fetch implementation seam (tests swap global fetch out). */
export type FetchFn = typeof fetch;
/** Query the daily check-in status (and current credits when present). */
export declare function traeStatus(token: string, deviceId: string, fetchFn?: FetchFn): Promise<TraeStatus>;
/** Claim today's check-in credits. */
export declare function traeClaim(token: string, deviceId: string, fetchFn?: FetchFn): Promise<void>;
/** Remaining total from the credits ledger (usage_summary.total - consumed). */
export interface TraeEntitlements {
    remaining: number;
    totalAmount: number;
    consumedAmount: number;
}
/**
 * Query the credits ledger — the dashboard's own source for 总可用积分.
 * checkin_credits/status's `credits` field is only the check-in sub-wallet,
 * not the account total.
 */
export declare function traeEntitlements(token: string, deviceId: string, fetchFn?: FetchFn): Promise<TraeEntitlements>;

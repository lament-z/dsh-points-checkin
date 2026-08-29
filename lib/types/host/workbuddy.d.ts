import type { FetchFn } from './trae.ts';
/** Desktop auth file candidates (probe order; mirrors dsh-workbuddy-connect). */
export declare function desktopAuthCandidates(): string[];
/** Resolved WorkBuddy credential. */
export interface WbCredential {
    accessToken: string;
    refreshToken: string;
    expiresAtMs: number;
    refreshExpiresAtMs?: number;
    uid: string;
    enterpriseId?: string;
    domain: string;
    /** Where the credential came from (panel display only). */
    source: 'desktop' | 'plugin-copy' | 'manual';
}
/** Parse the desktop document in either shape (nested auth/account or flat). */
export declare function parseDesktopAuth(text: string): WbCredential | undefined;
/** Best available credential: manual token, else plugin copy vs desktop file. */
export declare function resolveStoredCredential(manualToken?: string): Promise<WbCredential | undefined>;
/** Persist a refreshed credential into the plugin-owned copy. */
export declare function persistRefreshedCredential(credential: WbCredential): Promise<void>;
export declare function billingHeaders(credential: WbCredential): Record<string, string>;
export interface WorkbuddyStatus {
    checkedIn: boolean | null;
    /** Aggregated remaining credit across the account's packages. */
    points: number | null;
    /** Per-package breakdown (packageName + remain). */
    accounts: Array<{
        packageName: string;
        remain: number;
        size: number;
    }>;
}
/** Sum remaining credit across packages, per the official client's algorithm. */
export declare function parseAccounts(data: unknown): WorkbuddyStatus['accounts'];
/** Query the aggregated remaining credit (and package breakdown). */
export declare function workbuddyPoints(credential: WbCredential, fetchFn?: FetchFn): Promise<WorkbuddyStatus['accounts']>;
/**
 * Query the daily check-in status. The check-in endpoints are known only in
 * the web-console shape (no /v2 evidence exists), so only the bare path is
 * tried; an unknown data shape surfaces as null rather than an error.
 */
export declare function workbuddyStatus(credential: WbCredential, fetchFn?: FetchFn): Promise<WorkbuddyStatus>;
/** Claim today's check-in reward; an already-claimed day counts as success. */
export declare function workbuddyClaim(credential: WbCredential, fetchFn?: FetchFn): Promise<void>;
/** Exchange the refresh token for a fresh access token. */
export declare function workbuddyRefresh(credential: WbCredential, fetchFn?: FetchFn): Promise<WbCredential>;

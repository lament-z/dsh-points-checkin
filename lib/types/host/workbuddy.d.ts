import type { FetchFn } from './trae.ts';
/** Meter base (spec open item 1: confirm against a live capture). */
export declare const WORKBUDDY_BASE = "https://www.codebuddy.cn";
export interface WorkbuddyHeaders {
    token: string;
    userId?: string;
}
/**
 * Query the daily check-in status. The data envelope is opaque to static
 * analysis, so the parser below accepts both a direct boolean and common
 * wrapper shapes; unknown shapes surface as a protocol error.
 */
export interface WorkbuddyStatus {
    checkedIn: boolean;
    /** Present when the status payload carries a balance the parser recognizes. */
    points?: number;
}
/** Query the daily check-in status for the configured account. */
export declare function workbuddyStatus(account: WorkbuddyHeaders, fetchFn?: FetchFn): Promise<WorkbuddyStatus>;
/** Claim today's check-in reward. */
export declare function workbuddyClaim(account: WorkbuddyHeaders, fetchFn?: FetchFn): Promise<void>;
/**
 * Query the plan/resource snapshot (spec: get-user-resource with the
 * p_tcaca product code). The exact balance field is an open item; the raw
 * data is surfaced to the client for display heuristics.
 */
export declare function workbuddyResource(account: WorkbuddyHeaders, fetchFn?: FetchFn): Promise<unknown>;

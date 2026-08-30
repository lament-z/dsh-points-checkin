/** Credential material for one service. */
export interface TraeCredentials {
    /** Cloud-IDE-JWT token captured from the TRAE client or web console. */
    token: string;
    /** Optional x-device-id value; defaults to a stable plugin-local id. */
    deviceId?: string;
}
/** Credential material for the WorkBuddy (CodeBuddy) meter API. */
export interface WorkbuddyCredentials {
    /**
     * Bearer JWT from the desktop client, OR the web console's HttpOnly
     * `session` cookie value (routing decided in workbuddyRequestHeaders).
     */
    token: string;
    /** Optional X-User-Id header value injected alongside the auth material. */
    userId?: string;
}
/** All configured credentials, keyed by service. */
export interface Credentials {
    trae?: TraeCredentials;
    workbuddy?: WorkbuddyCredentials;
}
/** Per-service durable check-in state. */
export interface ServiceState {
    /** Local calendar date (YYYY-MM-DD) of the last successful claim. */
    lastCheckin?: string;
}
/** Durable state for every service. */
export interface CheckinState {
    trae?: ServiceState;
    workbuddy?: ServiceState;
}
/** Storage directory (overridable for tests via DSH_POINTS_CHECKIN_DIR). */
export declare function storeDir(): string;
/** Load credentials; undefined fields mean unset. */
export declare function readCredentials(): Promise<Credentials>;
/** Persist credentials atomically with owner-only permissions. */
export declare function writeCredentials(credentials: Credentials): Promise<void>;
/** Load check-in state. */
export declare function readState(): Promise<CheckinState>;
/** Persist check-in state atomically. */
export declare function writeState(state: CheckinState): Promise<void>;
/** Local calendar date (YYYY-MM-DD) for "checked in today" comparisons. */
export declare function todayLocal(): string;
/** Plugin-level settings (the panel's schedule configuration). */
export interface PluginSettings {
    /** Local time of day (HH:mm) for the scheduled automatic check-in. */
    checkinTime: string;
}
/** Default settings; a fresh install checks in at 09:00 local time. */
export declare const DEFAULT_SETTINGS: PluginSettings;
/** Load plugin settings with defaults filled in. */
export declare function readSettings(): Promise<PluginSettings>;
/** Persist plugin settings atomically. */
export declare function writeSettings(settings: PluginSettings): Promise<void>;

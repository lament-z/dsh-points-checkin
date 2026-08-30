/**
 * Host half wiring: credentials store, orchestrator, localhost bridge, and
 * the check-in schedule (startup catch-up plus the user-configured daily
 * time). Everything here runs in the DSH host process; the browser half
 * reaches it only through the bridge (see bridge.ts for the threat model
 * and port discovery contract).
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Start the plugin's host-side services on the given context. Returns a
 * disposer for tests.
 */
export declare function startPointsCheckin(ctx: Context): Promise<() => void>;

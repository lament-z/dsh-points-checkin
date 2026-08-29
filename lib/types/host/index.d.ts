/**
 * Host half wiring: credentials store, orchestrator, localhost bridge, and
 * the startup catch-up pass. Everything here runs in the DSH host process;
 * the browser half reaches it only through the bridge (see bridge.ts for the
 * threat model and port discovery contract).
 */
import type { Context } from '@deepseek-ai/cordis';
/** Install the plugin's host-side services on the given context. */
export declare function startPointsCheckin(ctx: Context): Promise<void>;

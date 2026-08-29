/**
 * Host loader entry for the points-checkin plugin — runs in the DSH host
 * process. The host half owns everything the browser half cannot do: calling
 * the upstream APIs (they send no CORS headers), storing the tokens on disk,
 * running the localhost bridge the panel talks to, and the startup catch-up
 * check-in.
 */
import type { Context } from '@deepseek-ai/cordis';
/** Apply the host half. */
export declare function apply(ctx: Context): void;

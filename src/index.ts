/**
 * Host loader entry for the points-checkin plugin — runs in the DSH host
 * process. The host half owns everything the browser half cannot do: calling
 * the upstream APIs (they send no CORS headers), storing the tokens on disk,
 * running the localhost bridge the panel talks to, and the startup catch-up
 * check-in.
 */
import type { Context } from '@deepseek-ai/cordis'
import { startPointsCheckin } from './host/index.ts'

/**
 * Apply the host half.
 *
 * Awaited on purpose: `startPointsCheckin` only reaches `ctx.effect` after two
 * awaits, and registering an effect on an already-disposed fiber rejects. The
 * host installs a process-wide `unhandledRejection` handler that exits, so a
 * floating promise here would take the whole dsh process down whenever the app
 * boots and then tears down right away — e.g. `dsh web --help`.
 */
export async function apply(ctx: Context): Promise<void> {
  await startPointsCheckin(ctx)
}

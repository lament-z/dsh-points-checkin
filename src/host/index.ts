/**
 * Host half wiring: credentials store, orchestrator, localhost bridge, and
 * the startup catch-up pass. Everything here runs in the DSH host process;
 * the browser half reaches it only through the bridge (see bridge.ts for the
 * threat model and port discovery contract).
 */
import type { Context } from '@deepseek-ai/cordis'
import { CheckinOrchestrator } from './checkin.ts'
import { startBridge } from './bridge.ts'

/** Install the plugin's host-side services on the given context. */
export async function startPointsCheckin(ctx: Context): Promise<void> {
  const log = (message: string): void => {
    try {
      ctx.logger('points-checkin').info(message)
    } catch {
      // Logger may be absent in unit-test contexts; bridge logs are advisory.
    }
  }
  const orchestrator = new CheckinOrchestrator()
  await orchestrator.reload()

  const bridge = await startBridge(orchestrator, log)
  if (!bridge) {
    log('bridge unavailable; the panel will show the plugin as unreachable')
    return
  }

  // Startup catch-up: claim anything not yet checked in today. Deferred so
  // host boot is never blocked on upstream latency.
  const catchup = setTimeout(() => {
    void orchestrator.ensureToday()
  }, 3_000)

  const dispose = (): void => {
    clearTimeout(catchup)
    bridge.close()
  }
  if (typeof (ctx as unknown as { effect?: unknown }).effect === 'function') {
    ;(ctx as unknown as { effect: (fn: () => () => void, name: string) => void }).effect(
      () => dispose,
      'points-checkin: bridge',
    )
  } else {
    log('ctx.effect unavailable; the bridge will outlive plugin disposal')
  }
}

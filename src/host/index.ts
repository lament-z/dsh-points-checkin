/**
 * Host half wiring: credentials store, orchestrator, localhost bridge, and
 * the check-in schedule (startup catch-up plus the user-configured daily
 * time). Everything here runs in the DSH host process; the browser half
 * reaches it only through the bridge (see bridge.ts for the threat model
 * and port discovery contract).
 */
import type { Context } from '@deepseek-ai/cordis'
import { CheckinOrchestrator } from './checkin.ts'
import { startBridge } from './bridge.ts'
import { readSettings, todayLocal } from './store.ts'

const SCHEDULE_TICK_MS = 30_000

/**
 * Start the plugin's host-side services on the given context. Returns a
 * disposer for tests.
 */
export async function startPointsCheckin(ctx: Context): Promise<() => void> {
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
    return () => {}
  }

  // Startup catch-up: claim anything not yet checked in today. Deferred so
  // host boot is never blocked on upstream latency.
  const catchup = setTimeout(() => {
    void orchestrator.ensureToday()
  }, 3_000)

  // Scheduled daily check-in: every tick, if the configured local time has
  // passed today and we have not fired today, run the catch-up. Settings are
  // re-read from disk each tick, so a panel save takes effect immediately
  // without any cross-module wiring.
  let lastScheduledDate: string | null = null
  const scheduler = setInterval(() => {
    void (async () => {
      try {
        const { checkinTime } = await readSettings()
        const [hour, minute] = checkinTime.split(':').map(Number)
        const now = new Date()
        const due = now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute)
        if (!due || lastScheduledDate === todayLocal()) return
        lastScheduledDate = todayLocal()
        log(`scheduled check-in fired (${checkinTime})`)
        await orchestrator.ensureToday()
      } catch {
        // The scheduler never throws; the next tick retries.
      }
    })()
  }, SCHEDULE_TICK_MS)

  const dispose = (): void => {
    clearTimeout(catchup)
    clearInterval(scheduler)
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
  return dispose
}

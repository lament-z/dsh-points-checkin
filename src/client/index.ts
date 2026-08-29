/**
 * Points-checkin plugin — browser half. Registers the `points-checkin` locale
 * dictionaries and a `sidebar.footer.action` entry (additive list seat beside
 * Settings) that opens the expanding points card. The upstream APIs block
 * browser CORS, so this half only talks to the host bridge; see api.ts.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the layout SlotMap merge (AppFrame's 'sidebar' hole).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the sidebar shell's SlotMap merge ('sidebar.footer.action').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PointsPanel } from './panel.tsx'
import { en, zh, type PointsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Points-checkin surface copy. */
    'points-checkin': PointsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'points-checkin'

/** Unique occupant id inside the sidebar footer action list. */
const ENTRY_ID = 'points-checkin'

/** Services required by this plugin. */
export const inject = ['slots', 'locale']

/**
 * Register the sidebar entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'points-checkin: dictionaries')

  // Additive action beside Settings at the sidebar foot; the occupant only
  // receives the column state (wide vs rail) plus the locale seat.
  ctx.slots.inject('sidebar.footer.action', () => {
    try {
      return ctx.slots.register({
        name: 'sidebar.footer.action',
        id: ENTRY_ID,
        locale: NS,
      }, PointsPanel)
    } catch {
      return () => {}
    }
  })
}

export type { PointsPanelProps } from './panel.tsx'
export type { PointsKey } from './locales.ts'
export type { Snapshot, ServiceSnapshot, CredentialsView } from './api.ts'

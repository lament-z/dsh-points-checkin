/**
 * Points-checkin plugin — browser half. Registers the `points-checkin` locale
 * dictionaries and a `sidebar.footer.action` entry (additive list seat beside
 * Settings) that opens the expanding points card. The upstream APIs block
 * browser CORS, so this half only talks to the host bridge; see api.ts.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type PointsKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Points-checkin surface copy. */
        'points-checkin': PointsKey;
    }
}
/** Services required by this plugin. */
export declare const inject: string[];
/**
 * Register the sidebar entry.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
export type { PointsPanelProps } from './panel.tsx';
export type { PointsKey } from './locales.ts';
export type { Snapshot, ServiceSnapshot } from './api.ts';

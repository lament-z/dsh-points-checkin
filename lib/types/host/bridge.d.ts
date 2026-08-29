import { CheckinOrchestrator } from './checkin.ts';
/** Ports probed, in order, by the browser half. */
export declare const PORT_CANDIDATES: number[];
export interface Bridge {
    /** The bound port (resolved during start). */
    port: number;
    close(): void;
}
/**
 * Start the bridge. Tries PORT_CANDIDATES in order; returns null when every
 * port is taken (the client panel will report "unreachable").
 */
export declare function startBridge(orchestrator: CheckinOrchestrator, log: (message: string) => void, ports?: readonly number[]): Promise<Bridge | null>;

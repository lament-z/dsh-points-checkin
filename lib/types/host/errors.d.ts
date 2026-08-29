/**
 * Typed API failure for the upstream check-in services. Every network,
 * protocol, and business failure lands here so the bridge and the client
 * panel can surface a stable error kind instead of a stack.
 */
export type ApiFailureKind = 'auth' | 'network' | 'protocol' | 'business';
export declare class ApiError extends Error {
    readonly kind: ApiFailureKind;
    /** Upstream business code, when the failure came from a code != 0 body. */
    readonly code?: number;
    constructor(kind: ApiFailureKind, message: string, code?: number);
}

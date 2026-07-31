export interface ParsedApiError {
    code: string | null;
    apiMessage: string | null;
    details: unknown;
    /**
     * Upgrade link carried by the flat entitlement-denial envelope
     * (`{ error: "over_free_cap", message, upgrade_url }`). Null for the
     * canonical `{ error: { code, message } }` shape.
     */
    upgradeUrl: string | null;
}
export declare function parseApiErrorBody(body: string): ParsedApiError;
export declare class DoplApiError extends Error {
    readonly status: number;
    readonly code: string | null;
    readonly apiMessage: string | null;
    readonly details: unknown;
    /** Upgrade link from an entitlement-denial body (else null). */
    readonly upgradeUrl: string | null;
    readonly responseBody: string;
    constructor(status: number, responseBody: string);
}
export declare class DoplAuthError extends DoplApiError {
    constructor(status: number, responseBody: string);
}
export declare class DoplNetworkError extends Error {
    readonly cause: unknown;
    constructor(message: string, cause?: unknown);
}
export declare class DoplTimeoutError extends DoplNetworkError {
    constructor(method: string, path: string, timeoutMs: number);
}
/**
 * The CALLER went away (Q14) — an external `AbortSignal` handed to the
 * transport fired, so the request was cancelled from our side rather than
 * timing out on the server's.
 *
 * Distinct from {@link DoplTimeoutError} on purpose: both arrive as an
 * `AbortError` from `fetch`, and reporting a client disconnect as "timed out
 * after 55000ms" sends whoever reads the log looking for a slow route that was
 * never slow. Still a `DoplNetworkError`, so every existing `catch` keeps
 * working unchanged.
 */
export declare class DoplAbortError extends DoplNetworkError {
    constructor(method: string, path: string);
}

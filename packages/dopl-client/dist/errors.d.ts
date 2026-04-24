export declare class DoplApiError extends Error {
    readonly status: number;
    readonly responseBody: string;
    constructor(status: number, responseBody: string, message?: string);
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

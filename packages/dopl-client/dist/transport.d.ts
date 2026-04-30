export interface DoplTransportOptions {
    toolHeaderName?: string;
    clientIdentifier?: string;
    /**
     * Active canvas (workspace) for this transport. When set, every
     * request emits an `X-Canvas-Id` header so the server scopes data to
     * that canvas. When unset, the server falls back to the user's
     * default canvas.
     */
    canvasId?: string;
}
export interface RequestOptions {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
    toolName?: string;
    retries?: number;
}
export declare class DoplTransport {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly toolHeaderName;
    private readonly clientIdentifier;
    private canvasId;
    constructor(baseUrl: string, apiKey: string, opts?: DoplTransportOptions);
    /**
     * Update the active canvas after construction (e.g. CLI flow where
     * the user runs `dopl canvas use <slug>` mid-session).
     */
    setCanvasId(canvasId: string | null): void;
    getCanvasId(): string | null;
    getBaseUrl(): string;
    request<T>(path: string, options?: RequestOptions): Promise<T>;
    requestNoContent(path: string, method: string, toolName: string, body?: unknown): Promise<void>;
    buildHeaders(toolName?: string, withJsonBody?: boolean): Record<string, string>;
    private doFetch;
}

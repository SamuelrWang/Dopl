export interface DoplTransportOptions {
    toolHeaderName?: string;
    clientIdentifier?: string;
    /**
     * Active canvas (workspace) for this transport. When set, every
     * request emits an `X-Workspace-Id` header so the server scopes data to
     * that canvas. When unset, the server falls back to the user's
     * default canvas.
     */
    workspaceId?: string;
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
    private workspaceId;
    constructor(baseUrl: string, apiKey: string, opts?: DoplTransportOptions);
    /**
     * Update the active canvas after construction (e.g. CLI flow where
     * the user runs `dopl canvas use <slug>` mid-session).
     */
    setWorkspaceId(workspaceId: string | null): void;
    getWorkspaceId(): string | null;
    getBaseUrl(): string;
    request<T>(path: string, options?: RequestOptions): Promise<T>;
    /**
     * 204-expected request (DELETE, etc.). Audit fix #28: now goes
     * through the same retry / backoff path as `request<T>()`. DELETE is
     * in IDEMPOTENT_METHODS so the default retry budget applies; on
     * RETRIABLE_STATUS responses or transient network errors we retry
     * with jittered backoff just like GET. 401/403 still short-circuit;
     * a successful response (`res.ok || 204`) returns void.
     */
    requestNoContent(path: string, method: string, toolName: string, body?: unknown): Promise<void>;
    buildHeaders(toolName?: string, withJsonBody?: boolean): Record<string, string>;
    private doFetch;
}

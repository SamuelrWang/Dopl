import { AsyncLocalStorage } from "node:async_hooks";
/**
 * Per-async-call workspace override propagated through the call stack
 * via Node's AsyncLocalStorage. The MCP server uses this to route a
 * single tool call to a different workspace without mutating the
 * transport's stored `workspaceId` (which is the SESSION default).
 *
 * Resolution order in `buildHeaders()`:
 *   1. Explicit `workspaceIdOverride` on RequestOptions (per-call,
 *      visible at the call site).
 *   2. AsyncLocalStorage value (per-tool-call, set by the MCP
 *      `registerTool` wrapper — invisible to client.method() callers).
 *   3. Transport's stored `workspaceId` (session default).
 *   4. None — server falls back to user's default workspace.
 *
 * Exported so callers in `@dopl/mcp-server` can wrap a handler in
 * `workspaceContext.run(id, fn)`.
 */
export declare const workspaceContext: AsyncLocalStorage<string>;
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
    /**
     * Per-call workspace id, overriding both the AsyncLocalStorage value
     * (if any) and the transport's stored `workspaceId`. Lets a caller
     * direct a single request to a specific workspace without flipping
     * session-level state. The id must be a UUID — slug resolution
     * happens at the MCP layer before this point.
     */
    workspaceIdOverride?: string;
    /**
     * Extra per-call request headers (e.g. `X-Updated-At` for optimistic
     * concurrency). Reserved headers (Authorization, Content-Type, the
     * tool header, X-Dopl-Client, X-Workspace-Id) cannot be overridden.
     */
    customHeaders?: Record<string, string>;
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
    requestNoContent(path: string, method: string, toolName: string, body?: unknown, workspaceIdOverride?: string): Promise<void>;
    buildHeaders(toolName?: string, withJsonBody?: boolean, workspaceIdOverride?: string, customHeaders?: Record<string, string>): Record<string, string>;
    private doFetch;
}

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
 *   4. None — no header is sent; the server resolves fail-closed from the
 *      caller's memberships (a sole workspace auto-targets; 0 or 2+ →
 *      WORKSPACE_REQUIRED). No user-default fallback.
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
     * that canvas. When unset, no header is sent and the server resolves
     * fail-closed from the caller's memberships (a sole workspace
     * auto-targets; 0 or 2+ → WORKSPACE_REQUIRED).
     */
    workspaceId?: string;
    /**
     * Runtime label for the process this client acts for, echoed on every
     * request as `X-Dopl-Runtime`. The ONLY consumer is the server's reserved
     * `metadata.runtime` stamp, which distinguishes a desktop-spawned session
     * (`desktop-session`) from an external agent so the desktop does not open a
     * competing requester window for a thread an external session already owns.
     * Set by the in-app MCP route, which forwards the value it was called with;
     * unset means "external" and stamps nothing.
     */
    runtime?: string;
    /**
     * WHICH SESSION this client acts for, echoed on every request as
     * `X-Dopl-Session-Id` (F2). The ONLY consumer is the server's reserved
     * `metadata.session_id` stamp, which is what lets a reader tell two concurrent
     * sessions of one POSTER apart. It was written for named agents — `as_agent`
     * was ownership-checked and per-call, so it never said which process was
     * speaking — and it outlived them (channels rollback §1) because an agent post
     * is authored by its owner's ACCOUNT, so the author label still names a person
     * rather than a process. Set by the in-app MCP route, which forwards the value
     * it was called with; unset stamps nothing.
     *
     * A LABEL, NOT A LOCK: nothing gates on it, and no session count is enforced.
     */
    sessionId?: string;
    /**
     * CALLER-LIFETIME cancellation (Q14). The in-app MCP route passes the
     * incoming `Request.signal` here, so an MCP client hanging up mid-call (an
     * ESC during a `dopl_channel(op="await")` hold) stops the work instead of
     * leaving the hold re-polling for its remaining budget against a client that
     * is gone.
     *
     * Once it fires: NO further request is started, and no retry is attempted,
     * whatever the method. An IN-FLIGHT request is aborted only when the method
     * is idempotent — see the note in `request()` for why a mutation on the wire
     * is left alone.
     *
     * Combined with — not replaced by — a per-call `RequestOptions.signal`;
     * whichever fires first wins.
     */
    signal?: AbortSignal;
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
     * tool header, X-Dopl-Client, X-Dopl-Runtime, X-Dopl-Session-Id,
     * X-Workspace-Id) cannot be overridden.
     */
    customHeaders?: Record<string, string>;
    /**
     * Per-call cancellation (Q14). Combined with the transport-level
     * `DoplTransportOptions.signal` and, on idempotent methods, with this call's
     * own `timeoutMs` controller — whichever fires first aborts the fetch.
     *
     * An abort raises {@link DoplAbortError}, never a retry: retrying a request
     * whose caller has gone away is the exact waste this exists to stop.
     */
    signal?: AbortSignal;
}
export declare class DoplTransport {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly toolHeaderName;
    private readonly clientIdentifier;
    private readonly runtime;
    private readonly sessionId;
    private readonly signal;
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

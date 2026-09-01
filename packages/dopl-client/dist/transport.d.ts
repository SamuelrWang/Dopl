import { AsyncLocalStorage } from "node:async_hooks";
/**
 * Per-async-call workspace override. Routes ONE MCP tool call elsewhere without
 * mutating the transport's stored `workspaceId` (= SESSION default). Exported
 * so `@dopl/mcp-server` can `workspaceContext.run(id, fn)`. See
 * `buildHeaders()` for the resolution order.
 */
export declare const workspaceContext: AsyncLocalStorage<string>;
export interface DoplTransportOptions {
    toolHeaderName?: string;
    clientIdentifier?: string;
    /**
     * Active canvas. Set → every request emits `X-Workspace-Id`. Unset → no
     * header, server resolves fail-closed from memberships (sole workspace
     * auto-targets; 0 or 2+ → WORKSPACE_REQUIRED).
     */
    workspaceId?: string;
    /**
     * Runtime label, echoed as `X-Dopl-Runtime`. ONLY consumer: the server's
     * reserved `metadata.runtime` stamp, separating a desktop-spawned session
     * (`desktop-session`) from an external agent so the desktop does not open a
     * competing requester window for a thread an external session owns. Set by
     * the in-app MCP route; unset = external, stamps nothing.
     */
    runtime?: string;
    /**
     * Vendor label, echoed as `X-Dopl-Vendor` (2026-08-31, runtime-adapter port
     * step 1). WHICH AGENT RUNTIME drives the session the `runtime` label above
     * says the desktop spawned — `claude` | `codex` | `cursor`. A SECOND
     * DIMENSION, never a value of `runtime`: widening that enum would flip every
     * `=== "desktop-session"` comparison false for a non-Claude session. Set by
     * the in-app MCP route from the caller's own header; unset = unknown, and
     * unknown is never guessed.
     */
    vendor?: string;
    /**
     * Session label, echoed as `X-Dopl-Session-Id` (F2). ONLY consumer: the
     * server's reserved `metadata.session_id` stamp — what lets a reader tell two
     * concurrent sessions of one POSTER apart. A LABEL, NOT A LOCK: nothing gates
     * on it, no session count enforced. Set by the in-app MCP route.
     */
    sessionId?: string;
    /**
     * CALLER-LIFETIME cancellation (Q14). The in-app MCP route passes the
     * incoming `Request.signal`, so a client hanging up mid-call (ESC during a
     * `dopl_channel(op="await")` hold) stops the work.
     *
     * Once fired: NO further request starts, no retry, whatever the method. An
     * IN-FLIGHT request aborts only when the method is idempotent — see
     * `request()`. Combined with, not replaced by, `RequestOptions.signal`.
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
     * Per-call workspace id, overriding both AsyncLocalStorage and the stored
     * `workspaceId`. ⚠ Must be a UUID — slug resolution happens at the MCP layer
     * before this point.
     */
    workspaceIdOverride?: string;
    /**
     * Extra per-call headers (e.g. `X-Updated-At`). Reserved headers
     * (Authorization, Content-Type, the tool header, X-Dopl-Client,
     * X-Dopl-Runtime, X-Dopl-Session-Id, X-Workspace-Id) cannot be overridden.
     */
    customHeaders?: Record<string, string>;
    /**
     * Per-call cancellation (Q14). Combined with `DoplTransportOptions.signal`
     * and, on idempotent methods, this call's `timeoutMs` controller — first to
     * fire aborts the fetch. Raises {@link DoplAbortError}, never a retry.
     */
    signal?: AbortSignal;
}
export declare class DoplTransport {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly toolHeaderName;
    private readonly clientIdentifier;
    private readonly runtime;
    private readonly vendor;
    private readonly sessionId;
    private readonly signal;
    private workspaceId;
    constructor(baseUrl: string, apiKey: string, opts?: DoplTransportOptions);
    setWorkspaceId(workspaceId: string | null): void;
    getWorkspaceId(): string | null;
    getBaseUrl(): string;
    request<T>(path: string, options?: RequestOptions): Promise<T>;
    /**
     * 204-expected request (DELETE, etc.). Same retry / backoff path as
     * `request<T>()`; 401/403 short-circuit.
     */
    requestNoContent(path: string, method: string, toolName: string, body?: unknown, workspaceIdOverride?: string): Promise<void>;
    buildHeaders(toolName?: string, withJsonBody?: boolean, workspaceIdOverride?: string, customHeaders?: Record<string, string>): Record<string, string>;
    private doFetch;
}

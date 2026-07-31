"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoplTransport = exports.workspaceContext = void 0;
const debug_1 = __importDefault(require("debug"));
const node_async_hooks_1 = require("node:async_hooks");
const abort_js_1 = require("./abort.js");
const errors_js_1 = require("./errors.js");
const retry_js_1 = require("./retry.js");
const log = (0, debug_1.default)("dopl:client");
const DEFAULT_TIMEOUT_MS = 30_000;
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
exports.workspaceContext = new node_async_hooks_1.AsyncLocalStorage();
class DoplTransport {
    baseUrl;
    apiKey;
    toolHeaderName;
    clientIdentifier;
    runtime;
    signal;
    workspaceId;
    constructor(baseUrl, apiKey, opts = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.apiKey = apiKey;
        this.toolHeaderName = opts.toolHeaderName ?? "X-MCP-Tool";
        this.clientIdentifier = opts.clientIdentifier ?? null;
        this.runtime = opts.runtime ?? null;
        this.signal = opts.signal;
        this.workspaceId = opts.workspaceId ?? null;
    }
    /**
     * Update the active canvas after construction (e.g. CLI flow where
     * the user runs `dopl canvas use <slug>` mid-session).
     */
    setWorkspaceId(workspaceId) {
        this.workspaceId = workspaceId;
    }
    getWorkspaceId() {
        return this.workspaceId;
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    async request(path, options = {}) {
        const { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS, toolName, retries, workspaceIdOverride, customHeaders, signal, } = options;
        const maxAttempts = 1 +
            (retries ?? (retry_js_1.IDEMPOTENT_METHODS.has(method) ? retry_js_1.DEFAULT_GET_RETRIES : 0));
        // Q14 — per-call signal + the transport's caller-lifetime one.
        //
        // WHAT CANCELLATION MAY AND MAY NOT INTERRUPT, and why the split:
        //
        //  • NEVER START a request once the caller is gone. Checked at the top of
        //    every attempt, so this also covers a signal that fires during a
        //    backoff sleep. Nothing has been sent, so nothing can be half-applied
        //    — this is free, and it applies to every method.
        //
        //  • ONLY ABORT AN IN-FLIGHT request when the method is idempotent. That
        //    is the whole of the cost this exists to stop: the `op="await"` hold is
        //    GETs, and it is the only call that keeps working for minutes after its
        //    client hangs up. A mutation already on the wire is left to finish,
        //    because killing the loopback also kills the inner route mid-write, and
        //    the thread-create path is NOT yet atomic — cancelling it there is how
        //    you mint a half-built thread. Losing at most one short in-flight POST
        //    per cancelled call is not worth that.
        const externals = [signal, this.signal];
        const interruptible = retry_js_1.IDEMPOTENT_METHODS.has(method);
        let lastError = null;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if ((0, abort_js_1.anyAborted)(externals))
                throw new errors_js_1.DoplAbortError(method, path);
            const started = Date.now();
            try {
                const res = await this.doFetch(path, method, body, timeoutMs, toolName, workspaceIdOverride, customHeaders, interruptible ? externals : undefined);
                const duration = Date.now() - started;
                if (res.ok) {
                    log("%s %s → %d in %dms", method, path, res.status, duration);
                    // No-body successes (204, or an empty 200) must not explode in
                    // res.json() AFTER the server applied the operation — a caller
                    // that can't tell success from failure retries destructive ops.
                    if (res.status === 204)
                        return undefined;
                    const text = await res.text();
                    if (text === "")
                        return undefined;
                    return JSON.parse(text);
                }
                const text = await res.text();
                log("%s %s → %d in %dms (attempt %d/%d)", method, path, res.status, duration, attempt + 1, maxAttempts);
                if (res.status === 401 || res.status === 403) {
                    throw new errors_js_1.DoplAuthError(res.status, text);
                }
                if (retry_js_1.RETRIABLE_STATUS.has(res.status) && attempt < maxAttempts - 1) {
                    const waitMs = (0, retry_js_1.waitForStatus)(res, attempt);
                    log("retrying after %dms", waitMs);
                    await (0, retry_js_1.sleep)(waitMs);
                    lastError = new errors_js_1.DoplApiError(res.status, text);
                    continue;
                }
                throw new errors_js_1.DoplApiError(res.status, text);
            }
            catch (error) {
                if (error instanceof errors_js_1.DoplApiError)
                    throw error;
                const networkError = wrapNetworkError(method, path, timeoutMs, error, interruptible && (0, abort_js_1.anyAborted)(externals));
                log("%s %s network error: %s (attempt %d/%d)", method, path, networkError.message, attempt + 1, maxAttempts);
                // Never retry a caller-cancelled request.
                if (networkError instanceof errors_js_1.DoplAbortError)
                    throw networkError;
                if (attempt < maxAttempts - 1) {
                    const waitMs = (0, retry_js_1.computeBackoff)(attempt);
                    log("retrying after %dms", waitMs);
                    await (0, retry_js_1.sleep)(waitMs);
                    lastError = networkError;
                    continue;
                }
                throw networkError;
            }
        }
        throw lastError ?? new errors_js_1.DoplNetworkError(`Exhausted retries: ${method} ${path}`);
    }
    /**
     * 204-expected request (DELETE, etc.). Audit fix #28: now goes
     * through the same retry / backoff path as `request<T>()`. DELETE is
     * in IDEMPOTENT_METHODS so the default retry budget applies; on
     * RETRIABLE_STATUS responses or transient network errors we retry
     * with jittered backoff just like GET. 401/403 still short-circuit;
     * a successful response (`res.ok || 204`) returns void.
     */
    async requestNoContent(path, method, toolName, body, workspaceIdOverride) {
        const maxAttempts = 1 + (retry_js_1.IDEMPOTENT_METHODS.has(method) ? retry_js_1.DEFAULT_GET_RETRIES : 0);
        // Q14: this path carries DELETE/PATCH — mutations — so the caller's signal
        // gates whether a request is STARTED and never interrupts one in flight
        // (see the long note in `request`). No per-call signal here: the argument
        // list is positional, and the transport-level one is what the MCP route
        // sets.
        const externals = [this.signal];
        let lastError = null;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if ((0, abort_js_1.anyAborted)(externals))
                throw new errors_js_1.DoplAbortError(method, path);
            try {
                const res = await this.doFetch(path, method, body, DEFAULT_TIMEOUT_MS, toolName, workspaceIdOverride);
                if (res.ok || res.status === 204) {
                    log("%s %s → %d", method, path, res.status);
                    return;
                }
                const text = await res.text();
                log("%s %s → %d (attempt %d/%d)", method, path, res.status, attempt + 1, maxAttempts);
                if (res.status === 401 || res.status === 403) {
                    throw new errors_js_1.DoplAuthError(res.status, text);
                }
                if (retry_js_1.RETRIABLE_STATUS.has(res.status) && attempt < maxAttempts - 1) {
                    const waitMs = (0, retry_js_1.waitForStatus)(res, attempt);
                    log("retrying after %dms", waitMs);
                    await (0, retry_js_1.sleep)(waitMs);
                    lastError = new errors_js_1.DoplApiError(res.status, text);
                    continue;
                }
                throw new errors_js_1.DoplApiError(res.status, text);
            }
            catch (error) {
                if (error instanceof errors_js_1.DoplApiError)
                    throw error;
                if (error instanceof errors_js_1.DoplAuthError)
                    throw error;
                const networkError = wrapNetworkError(method, path, DEFAULT_TIMEOUT_MS, error);
                log("%s %s network error: %s (attempt %d/%d)", method, path, networkError.message, attempt + 1, maxAttempts);
                if (attempt < maxAttempts - 1) {
                    const waitMs = (0, retry_js_1.computeBackoff)(attempt);
                    log("retrying after %dms", waitMs);
                    await (0, retry_js_1.sleep)(waitMs);
                    lastError = networkError;
                    continue;
                }
                throw networkError;
            }
        }
        throw lastError ?? new errors_js_1.DoplNetworkError(`Exhausted retries: ${method} ${path}`);
    }
    buildHeaders(toolName, withJsonBody = true, workspaceIdOverride, customHeaders) {
        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
        };
        if (withJsonBody)
            headers["Content-Type"] = "application/json";
        if (toolName)
            headers[this.toolHeaderName] = toolName;
        if (this.clientIdentifier)
            headers["X-Dopl-Client"] = this.clientIdentifier;
        // Server-read, never caller-writable (it is on the reserved list below):
        // the runtime label the server turns into `metadata.runtime`.
        if (this.runtime)
            headers["X-Dopl-Runtime"] = this.runtime;
        // Resolution order: explicit per-call override > AsyncLocalStorage
        // (set by the MCP `registerTool` wrapper for one tool call) > the
        // transport's stored workspaceId (session default). Falling through
        // omits the header; the server then resolves fail-closed from the
        // caller's memberships (0 or 2+ → WORKSPACE_REQUIRED, no default).
        const effectiveWorkspaceId = workspaceIdOverride ?? exports.workspaceContext.getStore() ?? this.workspaceId;
        if (effectiveWorkspaceId)
            headers["X-Workspace-Id"] = effectiveWorkspaceId;
        // Custom headers last, but never allowed to clobber a reserved key.
        if (customHeaders) {
            const reserved = new Set([
                "authorization",
                "content-type",
                this.toolHeaderName.toLowerCase(),
                "x-dopl-client",
                "x-dopl-runtime",
                "x-workspace-id",
            ]);
            for (const [key, value] of Object.entries(customHeaders)) {
                if (!reserved.has(key.toLowerCase()))
                    headers[key] = value;
            }
        }
        return headers;
    }
    async doFetch(path, method, body, timeoutMs, toolName, workspaceIdOverride, customHeaders, externalSignals = []) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        // Q14: the caller's signal(s) fold into THIS request's timeout controller,
        // so a disconnect tears the socket down now instead of at `timeoutMs`.
        // `detach()` in the finally is not optional — the external signal outlives
        // the request, and a 215s await hold links it once per poll.
        const detach = (0, abort_js_1.linkAbort)(controller, externalSignals);
        try {
            return await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: this.buildHeaders(toolName, true, workspaceIdOverride, customHeaders),
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
        }
        finally {
            clearTimeout(timeout);
            detach();
        }
    }
}
exports.DoplTransport = DoplTransport;
function wrapNetworkError(method, path, timeoutMs, error, externalAborted = false) {
    if (error instanceof DOMException && error.name === "AbortError") {
        // Both cases arrive here as an AbortError; only the caller's signal being
        // aborted tells them apart, and the distinction is the whole point (Q14).
        return externalAborted
            ? new errors_js_1.DoplAbortError(method, path)
            : new errors_js_1.DoplTimeoutError(method, path, timeoutMs);
    }
    return new errors_js_1.DoplNetworkError(error instanceof Error ? error.message : String(error), error);
}

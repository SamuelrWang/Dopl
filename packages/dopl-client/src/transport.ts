import createDebug from "debug";
import { AsyncLocalStorage } from "node:async_hooks";

import { anyAborted, linkAbort } from "./abort.js";
import {
  DoplAbortError,
  DoplApiError,
  DoplAuthError,
  DoplNetworkError,
  DoplTimeoutError,
} from "./errors.js";
import {
  DEFAULT_GET_RETRIES,
  IDEMPOTENT_METHODS,
  RETRIABLE_STATUS,
  sleep,
  waitForStatus,
  computeBackoff,
} from "./retry.js";

const log = createDebug("dopl:client");

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
export const workspaceContext = new AsyncLocalStorage<string>();

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
   * tool header, X-Dopl-Client, X-Dopl-Runtime, X-Workspace-Id) cannot be
   * overridden.
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

export class DoplTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly toolHeaderName: string;
  private readonly clientIdentifier: string | null;
  private readonly runtime: string | null;
  private readonly signal: AbortSignal | undefined;
  private workspaceId: string | null;

  constructor(baseUrl: string, apiKey: string, opts: DoplTransportOptions = {}) {
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
  setWorkspaceId(workspaceId: string | null): void {
    this.workspaceId = workspaceId;
  }

  getWorkspaceId(): string | null {
    return this.workspaceId;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = "GET",
      body,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      toolName,
      retries,
      workspaceIdOverride,
      customHeaders,
      signal,
    } = options;

    const maxAttempts =
      1 +
      (retries ?? (IDEMPOTENT_METHODS.has(method) ? DEFAULT_GET_RETRIES : 0));

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
    const externals = [signal, this.signal] as const;
    const interruptible = IDEMPOTENT_METHODS.has(method);

    let lastError: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (anyAborted(externals)) throw new DoplAbortError(method, path);
      const started = Date.now();
      try {
        const res = await this.doFetch(
          path,
          method,
          body,
          timeoutMs,
          toolName,
          workspaceIdOverride,
          customHeaders,
          interruptible ? externals : undefined
        );
        const duration = Date.now() - started;

        if (res.ok) {
          log("%s %s → %d in %dms", method, path, res.status, duration);
          // No-body successes (204, or an empty 200) must not explode in
          // res.json() AFTER the server applied the operation — a caller
          // that can't tell success from failure retries destructive ops.
          if (res.status === 204) return undefined as T;
          const text = await res.text();
          if (text === "") return undefined as T;
          return JSON.parse(text) as T;
        }

        const text = await res.text();
        log(
          "%s %s → %d in %dms (attempt %d/%d)",
          method,
          path,
          res.status,
          duration,
          attempt + 1,
          maxAttempts
        );

        if (res.status === 401 || res.status === 403) {
          throw new DoplAuthError(res.status, text);
        }
        if (RETRIABLE_STATUS.has(res.status) && attempt < maxAttempts - 1) {
          const waitMs = waitForStatus(res, attempt);
          log("retrying after %dms", waitMs);
          await sleep(waitMs);
          lastError = new DoplApiError(res.status, text);
          continue;
        }
        throw new DoplApiError(res.status, text);
      } catch (error) {
        if (error instanceof DoplApiError) throw error;

        const networkError = wrapNetworkError(
          method,
          path,
          timeoutMs,
          error,
          interruptible && anyAborted(externals)
        );
        log(
          "%s %s network error: %s (attempt %d/%d)",
          method,
          path,
          networkError.message,
          attempt + 1,
          maxAttempts
        );

        // Never retry a caller-cancelled request.
        if (networkError instanceof DoplAbortError) throw networkError;
        if (attempt < maxAttempts - 1) {
          const waitMs = computeBackoff(attempt);
          log("retrying after %dms", waitMs);
          await sleep(waitMs);
          lastError = networkError;
          continue;
        }
        throw networkError;
      }
    }
    throw lastError ?? new DoplNetworkError(`Exhausted retries: ${method} ${path}`);
  }

  /**
   * 204-expected request (DELETE, etc.). Audit fix #28: now goes
   * through the same retry / backoff path as `request<T>()`. DELETE is
   * in IDEMPOTENT_METHODS so the default retry budget applies; on
   * RETRIABLE_STATUS responses or transient network errors we retry
   * with jittered backoff just like GET. 401/403 still short-circuit;
   * a successful response (`res.ok || 204`) returns void.
   */
  async requestNoContent(
    path: string,
    method: string,
    toolName: string,
    body?: unknown,
    workspaceIdOverride?: string
  ): Promise<void> {
    const maxAttempts =
      1 + (IDEMPOTENT_METHODS.has(method) ? DEFAULT_GET_RETRIES : 0);

    // Q14: this path carries DELETE/PATCH — mutations — so the caller's signal
    // gates whether a request is STARTED and never interrupts one in flight
    // (see the long note in `request`). No per-call signal here: the argument
    // list is positional, and the transport-level one is what the MCP route
    // sets.
    const externals = [this.signal] as const;

    let lastError: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (anyAborted(externals)) throw new DoplAbortError(method, path);
      try {
        const res = await this.doFetch(
          path,
          method,
          body,
          DEFAULT_TIMEOUT_MS,
          toolName,
          workspaceIdOverride
        );

        if (res.ok || res.status === 204) {
          log("%s %s → %d", method, path, res.status);
          return;
        }

        const text = await res.text();
        log(
          "%s %s → %d (attempt %d/%d)",
          method,
          path,
          res.status,
          attempt + 1,
          maxAttempts
        );

        if (res.status === 401 || res.status === 403) {
          throw new DoplAuthError(res.status, text);
        }
        if (RETRIABLE_STATUS.has(res.status) && attempt < maxAttempts - 1) {
          const waitMs = waitForStatus(res, attempt);
          log("retrying after %dms", waitMs);
          await sleep(waitMs);
          lastError = new DoplApiError(res.status, text);
          continue;
        }
        throw new DoplApiError(res.status, text);
      } catch (error) {
        if (error instanceof DoplApiError) throw error;
        if (error instanceof DoplAuthError) throw error;

        const networkError = wrapNetworkError(
          method,
          path,
          DEFAULT_TIMEOUT_MS,
          error
        );
        log(
          "%s %s network error: %s (attempt %d/%d)",
          method,
          path,
          networkError.message,
          attempt + 1,
          maxAttempts
        );

        if (attempt < maxAttempts - 1) {
          const waitMs = computeBackoff(attempt);
          log("retrying after %dms", waitMs);
          await sleep(waitMs);
          lastError = networkError;
          continue;
        }
        throw networkError;
      }
    }
    throw lastError ?? new DoplNetworkError(`Exhausted retries: ${method} ${path}`);
  }

  buildHeaders(
    toolName?: string,
    withJsonBody = true,
    workspaceIdOverride?: string,
    customHeaders?: Record<string, string>
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (withJsonBody) headers["Content-Type"] = "application/json";
    if (toolName) headers[this.toolHeaderName] = toolName;
    if (this.clientIdentifier) headers["X-Dopl-Client"] = this.clientIdentifier;
    // Server-read, never caller-writable (it is on the reserved list below):
    // the runtime label the server turns into `metadata.runtime`.
    if (this.runtime) headers["X-Dopl-Runtime"] = this.runtime;
    // Resolution order: explicit per-call override > AsyncLocalStorage
    // (set by the MCP `registerTool` wrapper for one tool call) > the
    // transport's stored workspaceId (session default). Falling through
    // omits the header; the server then resolves fail-closed from the
    // caller's memberships (0 or 2+ → WORKSPACE_REQUIRED, no default).
    const effectiveWorkspaceId =
      workspaceIdOverride ?? workspaceContext.getStore() ?? this.workspaceId;
    if (effectiveWorkspaceId) headers["X-Workspace-Id"] = effectiveWorkspaceId;
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
        if (!reserved.has(key.toLowerCase())) headers[key] = value;
      }
    }
    return headers;
  }

  private async doFetch(
    path: string,
    method: string,
    body: unknown,
    timeoutMs: number,
    toolName?: string,
    workspaceIdOverride?: string,
    customHeaders?: Record<string, string>,
    externalSignals: ReadonlyArray<AbortSignal | undefined> = []
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    // Q14: the caller's signal(s) fold into THIS request's timeout controller,
    // so a disconnect tears the socket down now instead of at `timeoutMs`.
    // `detach()` in the finally is not optional — the external signal outlives
    // the request, and a 215s await hold links it once per poll.
    const detach = linkAbort(controller, externalSignals);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.buildHeaders(
          toolName,
          true,
          workspaceIdOverride,
          customHeaders
        ),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      detach();
    }
  }
}

function wrapNetworkError(
  method: string,
  path: string,
  timeoutMs: number,
  error: unknown,
  externalAborted = false
): DoplNetworkError {
  if (error instanceof DOMException && error.name === "AbortError") {
    // Both cases arrive here as an AbortError; only the caller's signal being
    // aborted tells them apart, and the distinction is the whole point (Q14).
    return externalAborted
      ? new DoplAbortError(method, path)
      : new DoplTimeoutError(method, path, timeoutMs);
  }
  return new DoplNetworkError(
    error instanceof Error ? error.message : String(error),
    error
  );
}

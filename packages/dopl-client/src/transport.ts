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
 * Per-async-call workspace override. Routes ONE MCP tool call elsewhere without
 * mutating the transport's stored `workspaceId` (= SESSION default). Exported
 * so `@dopl/mcp-server` can `workspaceContext.run(id, fn)`. See
 * `buildHeaders()` for the resolution order.
 */
export const workspaceContext = new AsyncLocalStorage<string>();

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

export class DoplTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly toolHeaderName: string;
  private readonly clientIdentifier: string | null;
  private readonly runtime: string | null;
  private readonly sessionId: string | null;
  private readonly signal: AbortSignal | undefined;
  private workspaceId: string | null;

  constructor(baseUrl: string, apiKey: string, opts: DoplTransportOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.toolHeaderName = opts.toolHeaderName ?? "X-MCP-Tool";
    this.clientIdentifier = opts.clientIdentifier ?? null;
    this.runtime = opts.runtime ?? null;
    this.sessionId = opts.sessionId ?? null;
    this.signal = opts.signal;
    this.workspaceId = opts.workspaceId ?? null;
  }

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

    // Q14 — what cancellation may and may not interrupt:
    //  • NEVER START a request once the caller is gone. Checked at the top of
    //    every attempt, so a signal firing during a backoff sleep counts too.
    //  • ⚠ ONLY ABORT AN IN-FLIGHT request when the method is idempotent. A
    //    mutation on the wire is left to finish: killing the loopback kills the
    //    inner route mid-write, and thread-create is NOT atomic — cancelling
    //    there mints a half-built thread. One wasted short POST is cheaper.
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
          // ⚠ No-body successes (204, empty 200) must not explode in
          // res.json() AFTER the server applied the op — a caller that can't
          // tell success from failure retries destructive ops.
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
   * 204-expected request (DELETE, etc.). Same retry / backoff path as
   * `request<T>()`; 401/403 short-circuit.
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

    // Q14: mutations only here, so the signal gates whether a request is
    // STARTED and never interrupts one in flight (see `request`). No per-call
    // signal: arg list is positional; the MCP route sets the transport one.
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
    // Server-read, never caller-writable (both on the reserved list below).
    if (this.runtime) headers["X-Dopl-Runtime"] = this.runtime;
    if (this.sessionId) headers["X-Dopl-Session-Id"] = this.sessionId;
    // Order: per-call override > AsyncLocalStorage (set by the MCP
    // `registerTool` wrapper) > stored workspaceId (session default). Falling
    // through omits the header; the server then resolves fail-closed from
    // memberships — sole workspace auto-targets, 0 or 2+ → WORKSPACE_REQUIRED,
    // no user default.
    const effectiveWorkspaceId =
      workspaceIdOverride ?? workspaceContext.getStore() ?? this.workspaceId;
    if (effectiveWorkspaceId) headers["X-Workspace-Id"] = effectiveWorkspaceId;
    // Custom headers last, never allowed to clobber a reserved key.
    if (customHeaders) {
      const reserved = new Set([
        "authorization",
        "content-type",
        this.toolHeaderName.toLowerCase(),
        "x-dopl-client",
        "x-dopl-runtime",
        "x-dopl-session-id",
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
    // Q14: caller signals fold into THIS request's timeout controller, so a
    // disconnect tears the socket down now instead of at `timeoutMs`. ⚠ The
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
    // Timeout and caller-abort both arrive as AbortError; only the caller
    // signal's state tells them apart (Q14).
    return externalAborted
      ? new DoplAbortError(method, path)
      : new DoplTimeoutError(method, path, timeoutMs);
  }
  return new DoplNetworkError(
    error instanceof Error ? error.message : String(error),
    error
  );
}

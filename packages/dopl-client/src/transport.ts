import createDebug from "debug";
import { AsyncLocalStorage } from "node:async_hooks";

import {
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
 *   4. None — server falls back to user's default workspace.
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
}

export class DoplTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly toolHeaderName: string;
  private readonly clientIdentifier: string | null;
  private workspaceId: string | null;

  constructor(baseUrl: string, apiKey: string, opts: DoplTransportOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.toolHeaderName = opts.toolHeaderName ?? "X-MCP-Tool";
    this.clientIdentifier = opts.clientIdentifier ?? null;
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
    } = options;

    const maxAttempts =
      1 +
      (retries ?? (IDEMPOTENT_METHODS.has(method) ? DEFAULT_GET_RETRIES : 0));

    let lastError: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const started = Date.now();
      try {
        const res = await this.doFetch(
          path,
          method,
          body,
          timeoutMs,
          toolName,
          workspaceIdOverride
        );
        const duration = Date.now() - started;

        if (res.ok) {
          log("%s %s → %d in %dms", method, path, res.status, duration);
          return (await res.json()) as T;
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

        const networkError = wrapNetworkError(method, path, timeoutMs, error);
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

    let lastError: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
    workspaceIdOverride?: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (withJsonBody) headers["Content-Type"] = "application/json";
    if (toolName) headers[this.toolHeaderName] = toolName;
    if (this.clientIdentifier) headers["X-Dopl-Client"] = this.clientIdentifier;
    // Resolution order: explicit per-call override > AsyncLocalStorage
    // (set by the MCP `registerTool` wrapper for one tool call) > the
    // transport's stored workspaceId (session default). Falling through
    // omits the header so the server picks the user's default workspace.
    const effectiveWorkspaceId =
      workspaceIdOverride ?? workspaceContext.getStore() ?? this.workspaceId;
    if (effectiveWorkspaceId) headers["X-Workspace-Id"] = effectiveWorkspaceId;
    return headers;
  }

  private async doFetch(
    path: string,
    method: string,
    body: unknown,
    timeoutMs: number,
    toolName?: string,
    workspaceIdOverride?: string
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.buildHeaders(toolName, true, workspaceIdOverride),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function wrapNetworkError(
  method: string,
  path: string,
  timeoutMs: number,
  error: unknown
): DoplNetworkError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new DoplTimeoutError(method, path, timeoutMs);
  }
  return new DoplNetworkError(
    error instanceof Error ? error.message : String(error),
    error
  );
}

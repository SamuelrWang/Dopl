import createDebug from "debug";

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
    } = options;

    const maxAttempts =
      1 +
      (retries ?? (IDEMPOTENT_METHODS.has(method) ? DEFAULT_GET_RETRIES : 0));

    let lastError: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const started = Date.now();
      try {
        const res = await this.doFetch(path, method, body, timeoutMs, toolName);
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
    body?: unknown
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
          toolName
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

  buildHeaders(toolName?: string, withJsonBody = true): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (withJsonBody) headers["Content-Type"] = "application/json";
    if (toolName) headers[this.toolHeaderName] = toolName;
    if (this.clientIdentifier) headers["X-Dopl-Client"] = this.clientIdentifier;
    if (this.workspaceId) headers["X-Workspace-Id"] = this.workspaceId;
    return headers;
  }

  private async doFetch(
    path: string,
    method: string,
    body: unknown,
    timeoutMs: number,
    toolName?: string
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.buildHeaders(toolName),
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

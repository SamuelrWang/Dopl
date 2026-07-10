"use client";

/**
 * apiRequest — the single browser-side HTTP client for this app's
 * `/api/**` routes. Owns the conventions every feature previously
 * copy-pasted into its own `request<T>`:
 *
 *   - `x-workspace-id` header when `workspaceId` is provided.
 *   - JSON body encoding + `content-type`.
 *   - Optional `x-updated-at` concurrency precondition (412 on mismatch).
 *   - `undefined`-stripping query-param builder.
 *   - 204 → `undefined`; non-JSON error bodies degrade gracefully.
 *   - `!res.ok` → throws `ApiError` carrying the `{ error: { code,
 *     message, details } }` envelope from ENGINEERING §9.
 *
 * Feature clients that need domain-specific error subtypes (e.g. the
 * teams 409 conflict) catch/rethrow around this, they don't re-implement it.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiRequestOpts {
  workspaceId?: string;
  body?: unknown;
  /** Defaults to GET. */
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  /** Query params; `undefined` values are omitted. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Optimistic-concurrency precondition (`x-updated-at`). */
  expectedUpdatedAt?: string;
  signal?: AbortSignal;
}

export async function apiRequest<T>(
  path: string,
  opts: ApiRequestOpts = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.workspaceId) headers["x-workspace-id"] = opts.workspaceId;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.expectedUpdatedAt) headers["x-updated-at"] = opts.expectedUpdatedAt;

  let url = path;
  if (opts.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (path.includes("?") ? "&" : "?") + qs;
  }

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
    signal: opts.signal,
  });

  if (res.status === 204) return undefined as T;

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    if (!res.ok) throw new ApiError(res.status, "INTERNAL_ERROR", res.statusText);
    return undefined as T;
  }

  if (!res.ok) {
    const env = parsed as {
      error?: { code?: string; message?: string; details?: unknown } | string;
    };
    const err = env.error;
    if (typeof err === "string") throw new ApiError(res.status, "INTERNAL_ERROR", err);
    throw new ApiError(
      res.status,
      err?.code ?? "INTERNAL_ERROR",
      err?.message ?? res.statusText,
      err?.details
    );
  }

  return parsed as T;
}

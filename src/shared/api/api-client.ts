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

  // TRANSPORT SEAM (desktop migration Phase 2): inside the bundled desktop
  // SPA the renderer never touches the network — `window.dopl.apiRequest`
  // (the Electron IPC bridge; main attaches auth and fetches) is the
  // transport, and every reused feature client inherits it through this one
  // seam. On the web (no bridge) the plain fetch below runs unchanged. The
  // bridge answer is normalized into the same {status, json} shape so the
  // envelope/ApiError decoding beneath is shared verbatim by both paths.
  const bridge = (
    globalThis as {
      dopl?: {
        apiRequest(
          path: string,
          opts: {
            method?: string;
            body?: unknown;
            workspaceId?: string;
            expectedUpdatedAt?: string;
          }
        ): Promise<{
          status: number;
          statusText: string;
          hasBody: boolean;
          body?: unknown;
        }>;
      };
    }
  ).dopl;

  let res: { status: number; ok: boolean; statusText: string; json(): Promise<unknown> };
  if (bridge) {
    // NOTE: the `headers` map above is fetch-path-only — main reconstructs
    // every header (auth, workspace, updated-at, content-type) from the
    // structured opts. A new header added above must ALSO become a bridge
    // opt or it will silently not exist in the desktop app.
    // The IPC call itself cannot be cancelled; racing it against the abort
    // signal keeps TanStack's unmount/supersede semantics (the promise
    // settles, the response is discarded).
    const call = bridge.apiRequest(url, {
      method: opts.method ?? "GET",
      body: opts.body,
      workspaceId: opts.workspaceId,
      expectedUpdatedAt: opts.expectedUpdatedAt,
    });
    const out = await (opts.signal
      ? Promise.race([
          call,
          new Promise<never>((_resolve, reject) => {
            const onAbort = () =>
              reject(new DOMException("Aborted", "AbortError"));
            if (opts.signal!.aborted) onAbort();
            else opts.signal!.addEventListener("abort", onAbort, { once: true });
          }),
        ])
      : call);
    res = {
      status: out.status,
      ok: out.status >= 200 && out.status < 300,
      statusText: out.statusText,
      json: () =>
        out.hasBody ? Promise.resolve(out.body) : Promise.reject(new Error("no body")),
    };
  } else {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      signal: opts.signal,
    });
  }

  if (res.status === 204) return undefined as T;

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    if (!res.ok) {
      // statusText is "" over HTTP/2 — never surface an empty message.
      throw new ApiError(
        res.status,
        "INTERNAL_ERROR",
        res.statusText || `Request failed (${res.status})`
      );
    }
    return undefined as T;
  }

  if (!res.ok) {
    const env = parsed as {
      error?: { code?: string; message?: string; details?: unknown } | string;
      message?: string;
    };
    const err = env.error;
    if (typeof err === "string") {
      // Flat plan-gate envelope (ENGINEERING §8): `{ error: <code>,
      // message, upgrade_url }` — the string is the machine code and the
      // human text rides in a sibling `message`. A bare `{ error: "text" }`
      // has no sibling message, so keep the legacy INTERNAL_ERROR shape.
      if (typeof env.message === "string") {
        throw new ApiError(res.status, err, env.message);
      }
      throw new ApiError(res.status, "INTERNAL_ERROR", err);
    }
    throw new ApiError(
      res.status,
      err?.code ?? "INTERNAL_ERROR",
      err?.message || res.statusText || `Request failed (${res.status})`,
      err?.details
    );
  }

  return parsed as T;
}

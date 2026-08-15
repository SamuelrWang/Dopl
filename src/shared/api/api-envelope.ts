/**
 * The `/api/**` REQUEST CONTRACT minus the transport — ⚠ the ONE place the error
 * envelope, failure vocabulary, option shape and query-string builder are
 * defined for BOTH clients in the bundle:
 *
 *   `@/shared/api/api-client`        — fetch (web) / `window.dopl.apiRequest`
 *   `apps/desktop-ui/src/lib/api.ts` — the SPA's own IPC/fetch transport pair
 *
 * ⚠ Never re-declare `ApiError` per client: two instanceof-incompatible classes
 * in one SPA bundle means a 401 from a shared feature client is unrecognisable
 * to the SPA's `isUnauthorized`, and plan-gate envelope changes must be made
 * twice.
 *
 * ⚠ FRAMEWORK-FREE: no React, no Next, no `import.meta` — imported by the Next
 * client bundle and the Vite renderer alike.
 */

/** Non-2xx answer, carrying the `{ error: { code, message, details } }` envelope
 *  (ENGINEERING §9). ⚠ A request that never COMPLETED throws a plain `Error`
 *  (no `status`) — the distinction TanStack's retry predicate keys on. */
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

/** Appends `opts.query` to `path`, dropping `undefined` values. */
export function withQuery(
  path: string,
  query: ApiRequestOpts["query"]
): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? path + (path.includes("?") ? "&" : "?") + qs : path;
}

/** A transport's answer, normalized. `hasBody` is false for 204 and for a body
 *  the transport could not parse as JSON. ⚠ The decoder never re-reads a stream,
 *  so every transport (incl. the IPC bridge, which parses in main) feeds this
 *  same shape. */
export interface RawApiResponse {
  status: number;
  statusText: string;
  hasBody: boolean;
  body?: unknown;
}

/** Turn a transport answer into the resolved value, or throw `ApiError`. */
export function decodeResponse<T>(res: RawApiResponse): T {
  const ok = res.status >= 200 && res.status < 300;

  if (!res.hasBody) {
    // statusText is "" over HTTP/2 — never surface an empty message.
    if (!ok) {
      throw new ApiError(
        res.status,
        "INTERNAL_ERROR",
        res.statusText || `Request failed (${res.status})`
      );
    }
    return undefined as T;
  }

  if (!ok) {
    const env = res.body as {
      error?: { code?: string; message?: string; details?: unknown } | string;
      message?: string;
    };
    const err = env?.error;
    if (typeof err === "string") {
      // Flat plan-gate envelope (ENGINEERING §8): `{ error: <code>, message,
      // upgrade_url }` — string is the machine code, human text is the sibling
      // `message`. A bare `{ error: "text" }` has no sibling → INTERNAL_ERROR.
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

  return res.body as T;
}

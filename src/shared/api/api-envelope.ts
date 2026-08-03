/**
 * The `/api/**` REQUEST CONTRACT, minus the transport — the one place the
 * error envelope, the failure vocabulary, the option shape and the query-string
 * builder are defined for BOTH clients in the bundle.
 *
 * Two clients exist on purpose and only because their TRANSPORTS differ:
 *
 *   `@/shared/api/api-client`        — fetch (web) / `window.dopl.apiRequest`
 *                                      (bundled SPA, via the spa-bridge seam)
 *   `apps/desktop-ui/src/lib/api.ts` — the SPA's own IPC/fetch transport pair,
 *                                      which adds `VITE_API_BASE_URL` and
 *                                      abort-reason semantics for browser dev
 *
 * Everything ABOVE the transport lives here so they can never disagree. This is
 * load-bearing, not tidiness: before the extraction each client declared its
 * own `ApiError`, and two instanceof-incompatible classes shipped in one SPA
 * bundle — a 401 raised by a shared feature client could not be recognised by
 * the SPA's `isUnauthorized`, and a change to the plan-gate envelope had to be
 * made twice or the two halves of the app disagreed about error codes
 * (2026-08-03 fleet audit, duplication-quality). Same precedent as
 * `./query-defaults.ts`: framework-free contract in `src/shared/api/`, thin
 * bindings on either side.
 *
 * FRAMEWORK-FREE: no React, no Next, no `import.meta` — it is imported by the
 * Next client bundle and by the Vite renderer alike.
 */

/** The server answered with a non-2xx status. Carries the `{ error: { code,
 *  message, details } }` envelope from ENGINEERING §9. A request that never
 *  completed throws a plain `Error` (no `status`) instead — the distinction
 *  TanStack's shared retry predicate keys on. */
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

/**
 * A transport's answer, normalized. `hasBody` is false for 204 and for a body
 * the transport could not parse as JSON — the decoder never re-reads a stream,
 * so both transports (and the IPC bridge, which parses in main) feed it the
 * same shape.
 */
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
      // upgrade_url }` — the string is the machine code and the human text
      // rides in a sibling `message`. A bare `{ error: "text" }` has no sibling
      // message, so keep the legacy INTERNAL_ERROR shape.
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

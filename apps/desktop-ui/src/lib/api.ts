import { sendRequest } from "./api-transport";

/**
 * apiRequest — the single HTTP client for this renderer's `/api/**` calls, and
 * a faithful port of `src/shared/api/api-client.ts` (the web app's client).
 * Same signature, same headers, same error envelope; DIFFERENT transport.
 *
 * The web client called `fetch(url, { credentials: "same-origin" })`. Under
 * `file://` there is no origin and no cookie jar, so the transport is pluggable
 * (`./api-transport.ts`): the Electron IPC bridge when `window.dopl` exists,
 * plain `fetch` otherwise (dev-in-browser). Everything ABOVE the transport —
 * query building, headers, status handling, the `{ error: { code, message,
 * details } }` envelope (ENGINEERING §9) — is implemented exactly once, here,
 * so the two transports can never disagree about what an error means.
 *
 * Failure vocabulary, matching the web client so TanStack's retry predicate
 * (`QUERY_DEFAULT_OPTIONS`, shared with the web app) behaves identically:
 *   - the server answered non-2xx  → `ApiError` carrying `status` (4xx: no retry)
 *   - the request never completed  → a plain `Error` with no `status` (retried once)
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

interface RawResponse {
  status: number;
  statusText: string;
  hasBody: boolean;
  body?: unknown;
}

/**
 * The `{ error: … }` envelope decoder — ported verbatim from the web client so
 * every ported page keeps the error codes it already branches on.
 */
export function decodeResponse<T>(res: RawResponse): T {
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

export async function apiRequest<T>(
  path: string,
  opts: ApiRequestOpts = {}
): Promise<T> {
  const res = await sendRequest({
    path: withQuery(path, opts.query),
    method: opts.method ?? "GET",
    body: opts.body,
    workspaceId: opts.workspaceId,
    expectedUpdatedAt: opts.expectedUpdatedAt,
    signal: opts.signal,
  });
  return decodeResponse<T>(res);
}

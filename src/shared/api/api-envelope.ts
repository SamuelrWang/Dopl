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
 *  (ENGINEERING §9). A request that never completed is `status: 0`: a
 *  {@link NetworkError}, or a generic one ({@link transportFailure}). */
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

/** Shown when Dopl cannot be reached (offline, sleep/wake, dead socket). */
export const NETWORK_ERROR_MESSAGE = "Can't reach Dopl.";
/** Shown for anything that is not the server's own 4xx wording. */
export const GENERIC_ERROR_MESSAGE = "Dopl ran into a problem.";

/** The request never got an answer. `code` is `NETWORK_UNAVAILABLE` or `NETWORK_TIMEOUT`. */
export class NetworkError extends ApiError {
  constructor(code: string = "NETWORK_UNAVAILABLE") {
    super(0, code, NETWORK_ERROR_MESSAGE);
    this.name = "NetworkError";
  }
}

const NETWORK_CODE = /^NETWORK_/;
// The browser, undici and Electron wordings for a request that never completed.
const NETWORK_TEXT =
  /fetch failed|failed to fetch|networkerror when attempting to fetch|load failed|network request failed/i;

/** True for a {@link NetworkError}, a feature client's re-wrap of one (duck-typed
 *  `status: 0` + `NETWORK_*` code), or a raw fetch `TypeError` (supabase-js
 *  re-wraps that as `AuthRetryableFetchError`). */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; code?: unknown; name?: unknown; message?: unknown };
  if (e.status === 0 && typeof e.code === "string" && NETWORK_CODE.test(e.code)) return true;
  const fetchError = e.name === "TypeError" || e.name === "AuthRetryableFetchError";
  return fetchError && typeof e.message === "string" && NETWORK_TEXT.test(e.message);
}

/**
 * A transport rejection as the app sees it. The caller's own abort passes through untouched
 * (TanStack reads it as a cancel); anything else becomes a NetworkError or a generic
 * `ApiError(0)`, so no transport or Electron wrapper text can reach the screen.
 */
export function transportFailure(error: unknown, signal?: AbortSignal | null): unknown {
  if (signal?.aborted) return error;
  if (error instanceof ApiError) return error;
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (NETWORK_TEXT.test(text)) return new NetworkError();
  if (/abort|timed? ?out/i.test(text)) return new NetworkError("NETWORK_TIMEOUT");
  return new ApiError(0, "CLIENT_ERROR", GENERIC_ERROR_MESSAGE);
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
  // The desktop bridge's envelope for a request that never got an answer (main/ui-bridge-net.js).
  if (res.status === 0) {
    const code = (res.body as { error?: { code?: unknown } } | undefined)?.error?.code;
    if (typeof code === "string" && NETWORK_CODE.test(code)) throw new NetworkError(code);
    throw new ApiError(0, typeof code === "string" ? code : "CLIENT_ERROR", GENERIC_ERROR_MESSAGE);
  }

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

/** The `ApiError` a raw `fetch` site throws for a non-2xx answer and its parsed
 *  JSON body — the same decode `apiRequest` runs, so `userFacingMessage` can keep
 *  a 4xx's own wording. */
export function apiErrorFrom(status: number, body: unknown): ApiError {
  try {
    decodeResponse({ status, statusText: "", hasBody: body != null, body });
  } catch (err) {
    if (err instanceof ApiError) return err;
  }
  return new ApiError(status, "INTERNAL_ERROR", GENERIC_ERROR_MESSAGE);
}

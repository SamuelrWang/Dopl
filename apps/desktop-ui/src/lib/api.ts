import {
  ApiError,
  decodeResponse,
  withQuery,
  type ApiRequestOpts,
  type RawApiResponse,
} from "@/shared/api/api-envelope";
import { sendRequest } from "./api-transport";

/**
 * apiRequest — the single HTTP client for this renderer's `/api/**` calls.
 *
 * Same signature, same headers, same error envelope as the web app's client
 * (`@/shared/api/api-client`); DIFFERENT transport. The web client called
 * `fetch(url, { credentials: "same-origin" })`. Under `file://` there is no
 * origin and no cookie jar, so the transport is pluggable
 * (`./api-transport.ts`): the Electron IPC bridge when `window.dopl` exposes
 * one, plain `fetch` otherwise (dev-in-browser, where `VITE_API_BASE_URL` may
 * point at another origin).
 *
 * Everything ABOVE the transport — `ApiError`, the option shape, the query
 * builder, and the `{ error: { code, message, details } }` envelope decoder
 * (ENGINEERING §9) — is NOT re-implemented here: it is imported from
 * `@/shared/api/api-envelope`, the one contract module both clients share.
 * That is why a 401 thrown by a reused web feature client and a 401 thrown
 * here are the same `ApiError` class, and why the plan-gate envelope can only
 * be changed in one place. The re-exports below keep `#/lib/api` the address
 * this renderer imports those from.
 *
 * Failure vocabulary, matching the web client so TanStack's retry predicate
 * (`QUERY_DEFAULT_OPTIONS`, shared with the web app) behaves identically:
 *   - the server answered non-2xx  → `ApiError` carrying `status` (4xx: no retry)
 *   - the request never completed  → a plain `Error` with no `status` (retried once)
 */

export { ApiError, decodeResponse, withQuery };
export type { ApiRequestOpts, RawApiResponse };

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

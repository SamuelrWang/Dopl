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
 * Same signature, headers and error envelope as the web app's
 * `@/shared/api/api-client`; DIFFERENT transport. Under `file://` there is no
 * origin and no cookie jar, so the transport is pluggable
 * (`./api-transport.ts`).
 *
 * ⚠ Everything ABOVE the transport — `ApiError`, the option shape, the query
 * builder, the `{ error: { code, message, details } }` decoder (ENGINEERING §9)
 * — is IMPORTED from `@/shared/api/api-envelope`, never re-implemented, so a
 * 401 from a reused web feature client and a 401 from here are the same
 * `ApiError` class. The re-exports below keep `#/lib/api` the address this
 * renderer imports those from.
 *
 * Failure vocabulary, matching the web client so the shared TanStack retry
 * predicate behaves identically:
 *   - server answered non-2xx → `ApiError` with `status` (4xx: no retry)
 *   - request never completed → plain `Error`, no `status` (retried once)
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

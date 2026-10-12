"use client";

import { getSpaBridge } from "@/shared/lib/spa-bridge";
import {
  ApiError,
  decodeResponse,
  normalizeFetchResponse,
  requestHeaders,
  transportFailure,
  withQuery,
  type ApiRequestOpts,
  type RawApiResponse,
} from "./api-envelope";

/**
 * apiRequest — the single browser-side HTTP client for `/api/**`. Owns:
 *   - `x-workspace-id` header when `workspaceId` is given;
 *   - JSON body encoding + `content-type`;
 *   - optional `x-updated-at` concurrency precondition (412 on mismatch);
 *   - `undefined`-stripping query-param builder;
 *   - 204 → `undefined`; non-JSON error bodies degrade gracefully;
 *   - `!res.ok` → `ApiError` with the ENGINEERING §9 envelope;
 *   - a request that never completed → `NetworkError` / generic `ApiError(0)`
 *     (`transportFailure`), never the transport's raw text.
 *
 * ⚠ Everything but the TRANSPORT lives in `./api-envelope.ts`, shared verbatim
 * with `apps/desktop-ui/src/lib/api.ts`. This file owns only which wire the
 * bytes leave on. Feature clients needing domain error subtypes catch/rethrow
 * around this — they never re-implement it.
 */

// Re-exported so `instanceof ApiError` means the same thing whichever module a
// call site reached for.
export { ApiError };
export type { ApiRequestOpts };

export async function apiRequest<T>(
  path: string,
  opts: ApiRequestOpts = {}
): Promise<T> {
  const url = withQuery(path, opts.query);

  // TRANSPORT SEAM: in the bundled SPA the renderer never touches the network —
  // `window.dopl.apiRequest` (Electron IPC; main attaches auth and fetches) is
  // the transport, normalized into the same {status, hasBody, body} shape so
  // envelope/ApiError decoding is shared verbatim. ⚠ CAPABILITY-KEYED, never
  // truthiness — the legacy wrapper exposes a partial window.dopl with no
  // apiRequest (spa-bridge.ts).
  const bridge = getSpaBridge();

  let raw: RawApiResponse;
  if (bridge) {
    // ⚠ Main reconstructs every header (auth, workspace, updated-at,
    // content-type) from the structured opts. A new header added to the fetch
    // branch below must ALSO become a bridge opt, or it silently will not exist
    // in the desktop app.
    // ⚠ The IPC call cannot be cancelled; racing it against the abort signal
    // preserves TanStack's unmount/supersede semantics (promise settles,
    // response discarded).
    const call = bridge
      .apiRequest(url, {
        method: opts.method ?? "GET",
        body: opts.body,
        workspaceId: opts.workspaceId,
        expectedUpdatedAt: opts.expectedUpdatedAt,
      })
      .catch((err: unknown) => {
        throw transportFailure(err, opts.signal);
      });
    // ⚠ THE ABORT LISTENER IS REMOVED WHEN THE CALL WINS. `{ once: true }` only
    // fires it once; it does not detach a listener that never fired, so racing
    // without this left one listener on the signal per completed request (the
    // leak `api-transport.ts › ipcTransport` already avoids this way).
    const signal = opts.signal;
    const out = await (signal
      ? new Promise<RawApiResponse>((resolve, reject) => {
          const onAbort = () =>
            reject(new DOMException("Aborted", "AbortError"));
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
          call.then(resolve, reject).finally(() => {
            signal.removeEventListener("abort", onAbort);
          });
        })
      : call);
    raw = {
      status: out.status,
      statusText: out.statusText,
      hasBody: out.hasBody,
      body: out.body,
    };
  } else {
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: requestHeaders(opts),
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        credentials: "same-origin",
        signal: opts.signal,
      });
    } catch (err) {
      throw transportFailure(err, opts.signal);
    }
    raw = await normalizeFetchResponse(res);
  }

  return decodeResponse<T>(raw);
}

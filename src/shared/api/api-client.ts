"use client";

import { getSpaBridge } from "@/shared/lib/spa-bridge";
import {
  ApiError,
  decodeResponse,
  withQuery,
  type ApiRequestOpts,
  type RawApiResponse,
} from "./api-envelope";

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
 * Everything in that list except the transport lives in `./api-envelope.ts`,
 * shared verbatim with the desktop SPA's own client (`apps/desktop-ui/src/
 * lib/api.ts`) — one `ApiError` class, one decoder, one option shape for the
 * whole bundle. This file owns only WHICH WIRE the bytes leave on.
 *
 * Feature clients that need domain-specific error subtypes (e.g. the
 * teams 409 conflict) catch/rethrow around this, they don't re-implement it.
 */

// Re-exported so the ~30 existing `@/shared/api/api-client` importers keep
// compiling — and so `instanceof ApiError` means the same thing whichever
// module a call site reached for.
export { ApiError, withQuery, decodeResponse };
export type { ApiRequestOpts, RawApiResponse };

export async function apiRequest<T>(
  path: string,
  opts: ApiRequestOpts = {}
): Promise<T> {
  const url = withQuery(path, opts.query);

  // TRANSPORT SEAM (desktop migration Phase 2): inside the bundled desktop
  // SPA the renderer never touches the network — `window.dopl.apiRequest`
  // (the Electron IPC bridge; main attaches auth and fetches) is the
  // transport, and every reused feature client inherits it through this one
  // seam. On the web (no bridge) the plain fetch below runs unchanged. The
  // bridge answer is normalized into the same {status, hasBody, body} shape
  // so the envelope/ApiError decoding is shared verbatim by both paths.
  // CAPABILITY-KEYED, never truthiness: the legacy wrapper exposes a
  // partial window.dopl with no apiRequest — see spa-bridge.ts.
  const bridge = getSpaBridge();

  let raw: RawApiResponse;
  if (bridge) {
    // NOTE: main reconstructs every header (auth, workspace, updated-at,
    // content-type) from the structured opts. A new header added to the
    // fetch branch below must ALSO become a bridge opt or it will silently
    // not exist in the desktop app.
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
    raw = {
      status: out.status,
      statusText: out.statusText,
      hasBody: out.hasBody,
      body: out.body,
    };
  } else {
    const headers: Record<string, string> = {};
    if (opts.workspaceId) headers["x-workspace-id"] = opts.workspaceId;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.expectedUpdatedAt) headers["x-updated-at"] = opts.expectedUpdatedAt;

    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      signal: opts.signal,
    });
    raw =
      res.status === 204
        ? { status: res.status, statusText: res.statusText, hasBody: false }
        : await readJsonBody(res);
  }

  return decodeResponse<T>(raw);
}

/** `fetch` half of the normalization: an unparseable body is "no body", which
 *  the decoder turns into `undefined` (2xx) or a statusText ApiError (non-2xx). */
async function readJsonBody(res: Response): Promise<RawApiResponse> {
  try {
    const body = await res.json();
    return {
      status: res.status,
      statusText: res.statusText,
      hasBody: true,
      body,
    };
  } catch {
    return { status: res.status, statusText: res.statusText, hasBody: false };
  }
}

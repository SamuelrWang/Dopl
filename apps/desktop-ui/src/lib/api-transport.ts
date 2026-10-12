import {
  normalizeFetchResponse,
  requestHeaders,
  transportFailure,
} from "@/shared/api/api-envelope";
import { getBridge, type BridgeResponse } from "./dopl-bridge";

/**
 * The ONLY two ways bytes leave this renderer. ⚠ Nothing outside this file may
 * call `fetch` (see CONVENTIONS.md).
 *
 *   IPC   (default in Electron): `window.dopl.apiRequest` → main → HTTPS. Main
 *         owns origin, auth header and connection pool; the renderer never sees
 *         a token and the packaged page ships `connect-src 'none'`.
 *   fetch (dev-in-browser, no bridge): `VITE_API_BASE_URL` names the API
 *         origin; empty = same-origin.
 *
 * Both return `BridgeResponse`. A request that does not complete throws a
 * `NetworkError` or a generic `ApiError(0)` (`transportFailure`), never raw
 * transport text; the caller's own abort passes through. `../lib/api.ts` owns
 * everything above that line.
 */

export interface TransportRequest {
  /** Path WITH query string already applied, e.g. `/api/skills?limit=20`. */
  path: string;
  method: string;
  body?: unknown;
  workspaceId?: string;
  expectedUpdatedAt?: string;
  signal?: AbortSignal;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

async function fetchTransport(req: TransportRequest): Promise<BridgeResponse> {
  let res: Response;
  try {
    res = await fetch(API_BASE_URL + req.path, {
      method: req.method,
      headers: requestHeaders(req),
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      // Cross-origin dev needs the cookie sent explicitly; same-origin keeps the
      // stricter default. ⚠ The one request field the two transports disagree
      // on, and the reason `requestHeaders` does not own it.
      credentials: API_BASE_URL ? "include" : "same-origin",
      signal: req.signal,
    });
  } catch (err) {
    throw transportFailure(err, req.signal);
  }
  return normalizeFetchResponse(res);
}

/**
 * ⚠ Cancellation is BEST-EFFORT over IPC: aborting rejects this promise, but
 * the main-process request runs to completion and its result is dropped.
 */
function ipcTransport(req: TransportRequest): Promise<BridgeResponse> {
  const signal = req.signal;
  const bridge = getBridge();
  if (!bridge) return Promise.reject(transportFailure(new Error("Dopl bridge unavailable")));

  // An older main rejects a failed fetch with Electron's wrapper text; it is mapped here too.
  const invocation = bridge
    .apiRequest(req.path, {
      method: req.method,
      body: req.body,
      workspaceId: req.workspaceId,
      expectedUpdatedAt: req.expectedUpdatedAt,
    })
    .catch((err: unknown) => {
      throw transportFailure(err, signal);
    });

  if (!signal) return invocation;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));

  return new Promise<BridgeResponse>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    invocation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export function sendRequest(req: TransportRequest): Promise<BridgeResponse> {
  return getBridge() ? ipcTransport(req) : fetchTransport(req);
}

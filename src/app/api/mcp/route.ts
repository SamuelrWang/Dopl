import "server-only";
import { DoplClient } from "@dopl/client";
import { bootServer, clientIdentifier } from "@dopl/mcp-server/factory";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest } from "@/shared/auth/with-mcp-transport-auth";
import { readRuntimeHeader } from "@/shared/auth/runtime-header";

// Node runtime (SDK uses node:crypto); never Edge. Per-request auth ⇒ no
// caching.
//
// 300s, not the old 120s (WAKE-V1): every tool call but one is a short
// loopback round-trip, and `dopl_channel(op="await")` is the exception — it
// deliberately HOLDS for up to 240s so the pending call becomes a wake
// primitive (a caller that backgrounds a >2min MCP call is woken by its
// result). The function ceiling has to clear that hold, or the platform kills
// the await mid-hold and the wake never fires.
//
// 300 is REQUIRED, not merely preferred, and a clamp does NOT degrade
// gracefully. If the deployment plan (or a project setting) caps maxDuration
// below the 240s hold, op="await" breaks outright: the platform kills the
// function mid-hold, so every await returns an opaque transport error instead
// of the timed-out RESULT — and none of the re-arm teaching lives in an error,
// so the agent gets nothing to act on and cannot tell it from a network blip.
// VERIFY ON DEPLOY that the plan actually supports 300s here. If it cannot,
// shorten the hold to fit under the real ceiling first (DOPL_AWAIT_HOLD_MS,
// read by the await op) rather than shipping a hold the platform will cut.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Base URL the in-app MCP server calls for its `/api/*` tool requests (loopback,
 * carrying the caller's credential, to reuse withMcpAccess/withWorkspaceAuth).
 *
 * Use the EXACT host the request arrived on — NOT NEXT_PUBLIC_APP_URL — because
 * that env points at the apex (usedopl.com) which 307-redirects to www, and
 * `fetch` DROPS the Authorization header across that host change, 401-ing every
 * loopback call. The Host + X-Forwarded-Proto headers give the real public host
 * on Vercel (www.usedopl.com), so the loopback never redirects.
 */
function appBaseUrl(request: Request): string {
  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  try {
    return new URL(request.url).origin;
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";
  }
}

async function handle(request: Request): Promise<Response> {
  // 1. Authenticate at the transport boundary (bearer key; OAuth in Stage 3).
  //    Only headers are read here — the body stays intact for the transport.
  const authed = await authenticateMcpRequest(request);
  if (!authed.ok) return authed.response;
  const { credential, apiKeyWorkspaceId, scopes } = authed.auth;

  // 2. A DoplClient pointed at our own origin, carrying the caller's
  //    credential. Stateless HTTP can't persist a session default across
  //    requests, so workspace targeting comes from the X-Workspace-Id header
  //    (custom connectors — a per-request pin) or the key's locked
  //    workspace, with per-call `workspace=` still available on every tool.
  //    A blank/whitespace header is NOT a pin: normalize it to undefined so
  //    boot resolves via the membership directory instead of forwarding an
  //    empty X-Workspace-Id downstream (which would 400 every loopback call).
  const headerPin = request.headers.get("x-workspace-id")?.trim() || undefined;
  const workspaceId = headerPin ?? apiKeyWorkspaceId ?? undefined;
  // WAKE-V1: forward the caller's runtime label onto the loopback so a
  // desktop-spawned session's channel writes reach `resolvePostMetadata` with
  // it. Only the recognized value survives `readRuntimeHeader`, so an
  // arbitrary caller-set header cannot be laundered through this hop.
  const callerRuntime = readRuntimeHeader(request);
  const client = new DoplClient(appBaseUrl(request), credential, {
    clientIdentifier,
    workspaceId,
    runtime: callerRuntime,
  });

  // 3. Build the MCP server: status ping (admin flag) + workspace handshake +
  //    tool registration. pingRetries: 0 — a single fast attempt per request.
  //    onDiag → console.error so a failed status ping / directory load / a
  //    dropped X-Workspace-Id pin surfaces in the server logs instead of
  //    vanishing silently.
  //    (Optimization for later: cache this handshake by credential hash to
  //    avoid two loopback calls on every request.)
  const { server } = await bootServer(client, {
    pingRetries: 0,
    scopes,
    onDiag: (message) => console.error(message),
  });

  // 4. Stateless, JSON-response transport: each POST is a self-contained
  //    JSON-RPC exchange and our tools return single results (no SSE needed).
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  // handleRequest is Fetch-native (Web Request → Web Response) — no Node
  // req/res bridge needed. The server + transport are per-request locals; in
  // stateless JSON mode the response body is materialized, and the objects
  // are reclaimed by GC after the response is sent (nothing global to close).
  return transport.handleRequest(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

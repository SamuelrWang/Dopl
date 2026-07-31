import "server-only";
import { DoplClient } from "@dopl/client";
import { bootServer, clientIdentifier } from "@dopl/mcp-server/factory";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest } from "@/shared/auth/with-mcp-transport-auth";
import { readRuntimeHeader } from "@/shared/auth/runtime-header";
import { withSseKeepAlive } from "@/shared/api/sse-keep-alive";

// Node runtime (SDK uses node:crypto); never Edge. Per-request auth ⇒ no
// caching.
//
// 300s, not the old 120s (WAKE-V1): every tool call but one is a short
// loopback round-trip, and `dopl_channel(op="await")` is the exception — it
// deliberately HOLDS for up to 215s so the pending call becomes a wake
// primitive (a caller that backgrounds a >2min MCP call is woken by its
// result). The function ceiling has to clear that hold, or the platform kills
// the await mid-hold and the wake never fires.
//
// 300 is REQUIRED, not merely preferred, and a clamp does NOT degrade
// gracefully. If the deployment plan (or a project setting) caps maxDuration
// below the 215s hold, op="await" breaks outright: the platform kills the
// function mid-hold, so every await returns an opaque transport error instead
// of the timed-out RESULT — and none of the re-arm teaching lives in an error,
// so the agent gets nothing to act on and cannot tell it from a network blip.
// VERIFY ON DEPLOY that the plan actually supports 300s here. If it cannot,
// shorten the hold to fit under the real ceiling first (DOPL_AWAIT_HOLD_MS,
// read by the await op) rather than shipping a hold the platform will cut.
//
// Streaming is load-bearing here, so this route must stay on the Node runtime
// with no response buffering in front of it (no middleware, no CDN cache) —
// see the transport note in `handle()`.
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

  // 4. Stateless, STREAMING (SSE) transport: each POST is a self-contained
  //    JSON-RPC exchange, and the response headers flush BEFORE the tool runs.
  //
  //    FIX M1/H1 (Q9, 2026-07-31) — WHY THERE IS NO `enableJsonResponse` HERE.
  //    This route used to set `enableJsonResponse: true`. In that mode the SDK
  //    returns a PROMISE that only resolves once every JSON-RPC response is
  //    ready (webStandardStreamableHttp `handlePostRequest`), so NOTHING —
  //    status line included — reaches the client until the tool handler
  //    returns. Claude Code wraps each non-GET fetch to a `type: "http"` MCP
  //    server in an AbortController firing at `max(server.timeout ?? 60_000,
  //    60_000)` ms, and that timer bounds TIME-TO-RESPONSE-HEADERS. With no
  //    headers until the end, the 60s bound covered the WHOLE call: every
  //    long op died at exactly 60.0s — `op="await"` (destroying the wake
  //    primitive outright), but also `op="list"` and `dopl_kb` reads.
  //
  //    Dropping the flag puts the transport back on its default SSE path,
  //    which returns `new Response(readable, …)` synchronously after
  //    dispatching the message (the SDK's `_onrequest` defers the handler
  //    onto a promise chain and does not await it). Headers therefore flush at
  //    t≈0 and the 60s client bound covers only the handshake — so terminal
  //    CLI users, claude.ai connectors, Claude Desktop and third-party clients
  //    are all fixed WITHOUT a per-server `timeout` override, which is the
  //    point: we cannot configure any of them. The `timeout` entries the
  //    desktop writes on the servers it owns (main/mcp-config.js,
  //    main/sdk-loader.js, main/mcp-cli-entry.js) stay as belt-and-braces.
  //
  //    THE STREAM STAYS OPEN AND SILENT for the length of an `op="await"` hold
  //    (~215s), which is exactly what an intermediary's idle timeout kills, so
  //    the response is wrapped in `withSseKeepAlive` — SSE comments only, which
  //    every conforming parser ignores. Non-SSE responses (a 406, a 202) pass
  //    through untouched.
  //
  //    SAFE FOR EVERY CLIENT WE CAN SERVE: the transport already 406s any POST
  //    whose `Accept` does not list BOTH `application/json` and
  //    `text/event-stream`, in either mode. A client that works today
  //    therefore already advertises SSE, so this cannot narrow compatibility.
  //    Session handling is unchanged (`sessionIdGenerator: undefined` ⇒
  //    stateless, no `mcp-session-id` on either path, initialize handshake
  //    identical).
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  // handleRequest is Fetch-native (Web Request → Web Response) — no Node
  // req/res bridge needed. The server + transport are per-request locals, kept
  // alive by the open stream's closures until the response ends, then
  // reclaimed by GC (nothing global to close).
  return withSseKeepAlive(await transport.handleRequest(request));
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

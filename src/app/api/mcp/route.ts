import "server-only";
import { DoplClient } from "@dopl/client";
import { bootServer, clientIdentifier } from "@dopl/mcp-server/factory";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest } from "@/shared/auth/with-mcp-transport-auth";
import { readRuntimeHeader } from "@/shared/auth/runtime-header";
import { readSessionIdHeader } from "@/shared/auth/session-header";
import { withSseKeepAlive } from "@/shared/api/sse-keep-alive";

// ⚠ Node runtime required (SDK uses node:crypto); never Edge. Per-request auth ⇒ no caching.
//
// ⚠ maxDuration 300 is REQUIRED, not preferred: `dopl_channel(op="await")` HOLDS up to 215s.
// A plan/project cap below that kills the function mid-hold, so every await returns an opaque
// transport error instead of the timed-out RESULT (the re-arm teaching lives only in the result).
// VERIFY ON DEPLOY the plan supports 300s; if not, shorten the hold first (DOPL_AWAIT_HOLD_MS).
//
// ⚠ Streaming is load-bearing: no response buffering in front of this route (no middleware, no CDN).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Base URL for the in-app MCP server's `/api/*` loopback calls (carries caller's credential).
 *
 * ⚠ Use the EXACT arrival host, NOT NEXT_PUBLIC_APP_URL: that env points at the apex
 * (usedopl.com), which 307s to www, and `fetch` DROPS Authorization across a host change —
 * 401ing every loopback call.
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
  // Auth at transport boundary: headers only — body stays intact for the transport.
  const authed = await authenticateMcpRequest(request);
  if (!authed.ok) return authed.response;
  const { credential, apiKeyWorkspaceId, scopes, userId, credential_info } =
    authed.auth;

  // ⚠ Blank/whitespace X-Workspace-Id is NOT a pin: normalize to undefined so boot resolves via
  // the membership directory instead of forwarding an empty header (which 400s every loopback).
  const headerPin = request.headers.get("x-workspace-id")?.trim() || undefined;
  const workspaceId = headerPin ?? apiKeyWorkspaceId ?? undefined;
  // Runtime + session stamps forwarded onto the loopback. Only recognized values survive the
  // readers, so a caller-set header cannot be laundered through this hop.
  const callerRuntime = readRuntimeHeader(request);
  const callerSessionId = readSessionIdHeader(request);
  // `signal` hands the caller's disconnect to the loopback; without it nothing downstream learns
  // the client hung up and an orphaned `op="await"` keeps re-polling for its whole ~215s budget.
  // ⚠ Scope: the client refuses to START further requests but only interrupts in-flight IDEMPOTENT
  // ones — aborting a loopback mid-write would tear a non-atomic thread-create. See
  // `DoplTransport.request` in packages/dopl-client.
  const client = new DoplClient(appBaseUrl(request), credential, {
    clientIdentifier,
    workspaceId,
    runtime: callerRuntime,
    sessionId: callerSessionId,
    signal: request.signal,
  });

  // pingRetries: 0 — one fast attempt per request. onDiag → console.error so a failed status
  // ping / directory load / dropped X-Workspace-Id pin is visible in server logs.
  // `caller`: this route is the ONLY layer seeing both credential and request headers, so it is
  // the only place that can tell the agent who it is. Nothing here GATES — runtime is a routing
  // hint (`runtime-header.ts`), credentialLabel is caller-supplied text.
  const { server } = await bootServer(client, {
    pingRetries: 0,
    scopes,
    caller: {
      userId,
      runtime: callerRuntime ?? null,
      credentialKind: credential_info.kind,
      credentialLabel: credential_info.label,
    },
    onDiag: (message) => console.error(message),
  });

  // ⚠ NEVER set `enableJsonResponse: true` here. That mode makes the SDK resolve only once every
  // JSON-RPC response is ready, so no headers reach the client until the tool handler returns —
  // and Claude Code's AbortController (max(server.timeout ?? 60_000, 60_000)) bounds
  // TIME-TO-RESPONSE-HEADERS, so every long op died at exactly 60.0s. Default SSE path returns
  // `new Response(readable, …)` synchronously, so headers flush at t≈0 and the 60s bound covers
  // only the handshake — fixing every client we cannot configure.
  //
  // The stream stays open and SILENT for an ~215s `op="await"` hold, which intermediaries reap,
  // hence `withSseKeepAlive` (SSE comments only; non-SSE responses pass through untouched).
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  // Server + transport are per-request locals, kept alive by the stream's closures until the
  // response ends, then GC'd — nothing global to close.
  return withSseKeepAlive(await transport.handleRequest(request));
}

export const POST = handle;
export const DELETE = handle;

/**
 * ⚠ GET IS 405 AND MUST NOT GO TO `handle`.
 *
 * GET asks for the standalone SSE stream — the server-initiated channel a STATEFUL server uses.
 * We are stateless (`sessionIdGenerator: undefined`), so no POST invocation can ever reach a
 * stream another one opened. Routing GET to `handle` fails by SUCCEEDING: the SDK skips session
 * validation in stateless mode and answers 200 `text/event-stream` with a stream nothing writes
 * to or closes, which `withSseKeepAlive` then keeps alive to `maxDuration` (300s). Every SDK
 * client opens it after `notifications/initialized` and reconnects on graceful end ⇒ one
 * permanently-running 300s function per client, burning the concurrency `op="await"` holds need.
 *
 * 405 is the spec'd answer; the SDK client's `_startOrAuthSse` returns on it without raising or
 * reconnecting. No auth runs first: a method-level refusal reveals nothing, and cheap is the point.
 */
export function GET(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message:
          "Method Not Allowed: this MCP endpoint is stateless and offers no standalone SSE stream at GET. Send JSON-RPC over POST.",
      },
      id: null,
    }),
    {
      status: 405,
      headers: {
        // RFC 9110 requires Allow on a 405.
        Allow: "POST, DELETE",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}

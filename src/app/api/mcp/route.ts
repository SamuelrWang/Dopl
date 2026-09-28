import "server-only";
import { bootServer } from "@dopl/mcp-server/factory";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest } from "@/shared/auth/with-mcp-transport-auth";
import { readToolProfileHeader } from "@/shared/auth/tool-profile-header";
import { readToolSetClaim } from "@/shared/auth/tool-set-header";
import { withSseKeepAlive } from "@/shared/api/sse-keep-alive";
import { loopbackClient } from "@/shared/api/loopback-client";
import { exposeGlassesTools } from "@/features/glasses/core/mcp/exposure";

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

async function handle(request: Request): Promise<Response> {
  // Auth at transport boundary: headers only — body stays intact for the transport.
  const authed = await authenticateMcpRequest(request);
  if (!authed.ok) return authed.response;
  const { credential, apiKeyWorkspaceId, scopes, userId, credential_info } =
    authed.auth;

  // 🔒 KEY LOCK FIRST, HEADER SECOND — and blank is not a pin on either. The
  // precedence, and why it was inverted on 2026-08-26, live in
  // `shared/auth/mcp-transport-pin.ts`, which is where the test drives it.
  // Runtime + session stamps forwarded onto the loopback. Only recognized values survive the
  // readers, so a caller-set header cannot be laundered through this hop.
  // CUSTODY (runtime) and VENDOR are two dimensions, never one widened enum
  // (`shared/auth/runtime-header.ts`). Absent stays absent: an older desktop
  // build sends no vendor, and reading `desktop-session` as "therefore Claude"
  // is the conflation the second header exists to prevent.
  // `signal` hands the caller's disconnect to the loopback; without it nothing downstream learns
  // the client hung up and an orphaned `op="await"` keeps re-polling for its whole ~215s budget.
  // ⚠ Scope: the client refuses to START further requests but only interrupts in-flight IDEMPOTENT
  // ones — aborting a loopback mid-write would tear a non-atomic thread-create. See
  // `DoplTransport.request` in packages/dopl-client.
  // All of it is built once in `shared/api/loopback-client.ts › loopbackClient`.
  const {
    client,
    runtime: callerRuntime,
    vendor: callerVendor,
    sessionId: callerSessionId,
  } = loopbackClient(request, credential, apiKeyWorkspaceId);
  // THE CONTAINMENT PROFILE this connection is running under, so `createServer`
  // can offer it a narrower tool set. ⚠ It may only NARROW and it GATES NOTHING
  // — the vocabulary lives in `@dopl/mcp-server › gating.ts › TOOL_PROFILES`,
  // which is also where a value this server cannot place falls to the narrowest
  // profile. Not forwarded onto the loopback: it is about what THIS MCP
  // connection is offered, not about what the app does with a request.
  const callerToolProfile = readToolProfileHeader(request);

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
      vendor: callerVendor ?? null,
      credentialKind: credential_info.kind,
      credentialLabel: credential_info.label,
      // 🔒 THE CREDENTIAL'S CONTAINER LOCK, and the ONE thing on `caller` that
      // gates: it rides the token row rather than a header, and only
      // `mcp-container-token.ts` sets it — for a container SESSION the desktop
      // spawned. `@dopl/mcp-server › identity.ts › isDesktopRun` reads it as
      // the second mark of a desktop-run caller, beside the runtime stamp.
      containerId: apiKeyWorkspaceId,
      // ⚠ WHICH SESSION, not just which account (F-405). `op="await"` needs it
      // to suppress its OWN echo without also suppressing a SIBLING session on
      // the same account — one operator runs many concurrent agents and every
      // post is authored by the ACCOUNT, so excluding on `userId` made a
      // same-account counterparty permanently invisible to the hold. Same value
      // already goes to the client above, which is what stamps it onto this
      // session's own posts; the two must come from the one read.
      sessionId: callerSessionId ?? null,
    },
    // ⚠ CONTAINMENT, NOT PRIVILEGE. See `readToolProfileHeader` above and
    // `BootOptions.toolProfile`: only an ABSENT header means "serve everything",
    // while a header this server cannot read narrows to the floor rather than
    // widening on a value nobody could parse.
    toolProfile: callerToolProfile,
    toolSet: readToolSetClaim(request),
    onDiag: (message) => console.error(message),
  });

  // GLASSES TOOLS ride this surface only for a caller with paired glasses under a containment
  // profile that offers them (`features/glasses/core/mcp/exposure.ts`); metered per call through
  // this request's own loopback client, like every `dopl_*` tool.
  await exposeGlassesTools(
    server,
    {
      userId,
      scopes,
      toolProfile: callerToolProfile,
      client,
      lockedContainerId: apiKeyWorkspaceId,
      signal: request.signal,
    },
    { requireDevice: true },
  );

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

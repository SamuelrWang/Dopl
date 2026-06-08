import "server-only";
import { DoplClient } from "@dopl/client";
import { bootServer, clientIdentifier } from "@dopl/mcp-server/factory";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest } from "@/shared/auth/with-mcp-transport-auth";

// Node runtime (SDK uses node:crypto); never Edge. Per-request auth ⇒ no
// caching. 120s ceiling is ample — tool calls are short loopback round-trips.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  //    credential. Stateless HTTP can't persist `set_workspace` across
  //    requests, so workspace targeting comes from the X-Workspace-Id header
  //    (custom connectors) or the key's locked workspace, with per-call
  //    `workspace=` still available on every tool.
  const workspaceId =
    request.headers.get("x-workspace-id") || apiKeyWorkspaceId || undefined;
  const client = new DoplClient(appBaseUrl(request), credential, {
    clientIdentifier,
    workspaceId,
  });

  // 3. Build the MCP server: status ping (admin flag) + workspace handshake +
  //    tool registration. pingRetries: 0 — a single fast attempt per request.
  //    (Optimization for later: cache this handshake by credential hash to
  //    avoid two loopback calls on every request.)
  const { server } = await bootServer(client, { pingRetries: 0, scopes });

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

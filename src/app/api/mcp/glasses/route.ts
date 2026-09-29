import "server-only";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authenticateMcpRequest } from "@/shared/auth/with-mcp-transport-auth";
import { withSseKeepAlive } from "@/shared/api/sse-keep-alive";
import { loopbackClient } from "@/shared/api/loopback-client";
import { readToolProfileHeader } from "@/shared/auth/tool-profile-header";
import { exposeGlassesTools } from "@/features/glasses/core/mcp/exposure";

/**
 * `/api/mcp/glasses`: the focused glasses MCP endpoint for external agents
 * (docs/glasses-mcp.md). Same OAuth bearer, transport and metering as
 * `/api/mcp`, but only the glasses tools, offered to any caller whose
 * containment profile allows them. `glasses_ask` holds up to 200s, hence
 * maxDuration 300 and the SSE keep-alive.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: Request): Promise<Response> {
  const authed = await authenticateMcpRequest(request);
  if (!authed.ok) return authed.response;
  const { userId, scopes, credential, apiKeyWorkspaceId } = authed.auth;
  const server = new McpServer({ name: "dopl-glasses", version: "0.2.0" });
  const { client } = loopbackClient(request, credential, apiKeyWorkspaceId);
  await exposeGlassesTools(
    server,
    {
      userId,
      scopes,
      toolProfile: readToolProfileHeader(request),
      client,
      lockedContainerId: apiKeyWorkspaceId,
    },
    { requireDevice: false },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return withSseKeepAlive(await transport.handleRequest(request));
}

export const POST = handle;
export const DELETE = handle;

/** Stateless: no standalone SSE stream (same as `/api/mcp`'s GET). */
export function GET(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method Not Allowed: send JSON-RPC over POST." }, id: null }),
    { status: 405, headers: { Allow: "POST, DELETE", "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}

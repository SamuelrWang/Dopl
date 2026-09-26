import "server-only";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest } from "@/shared/auth/with-mcp-transport-auth";
import { withSseKeepAlive } from "@/shared/api/sse-keep-alive";
import { createGlassesMcpServer } from "@/features/glasses/tools";
import { glassesRepository } from "@/features/glasses/repository";

/**
 * `/api/mcp/glasses` — the Glasses MCP prototype (docs/glasses-mcp.md). Same
 * OAuth bearer and same transport shape as `/api/mcp`, but its OWN five-tool
 * server, so the main surface does not grow. `glasses_ask` holds up to 200s,
 * hence maxDuration 300 and the SSE keep-alive, exactly as `/api/mcp`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: Request): Promise<Response> {
  const authed = await authenticateMcpRequest(request);
  if (!authed.ok) return authed.response;
  const server = createGlassesMcpServer(
    { store: glassesRepository },
    authed.auth.userId,
    {
      // Fail closed, same as `/api/mcp`: writes only on an explicit dopl.write.
      canWrite: authed.auth.scopes?.includes("dopl.write") ?? false,
      signal: request.signal,
    },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return withSseKeepAlive(await transport.handleRequest(request));
}

export const POST = handle;
export const DELETE = handle;

/** Stateless: no standalone SSE stream (same reasoning as `/api/mcp`'s GET). */
export function GET(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method Not Allowed: send JSON-RPC over POST." },
      id: null,
    }),
    {
      status: 405,
      headers: {
        Allow: "POST, DELETE",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

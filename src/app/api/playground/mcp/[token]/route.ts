import {
  POST as mcpPost,
  DELETE as mcpDelete,
  GET as mcpGet,
} from "@/app/api/mcp/route";

/**
 * /api/playground/mcp/<token> — the playground MCP endpoint with the guest
 * bearer embedded in the URL. Exists because desktop MCP clients (claude.ai
 * connectors, Claude Desktop) accept a URL and nothing else — no custom
 * headers — while the credential is still a normal `mcp_tokens` bearer. The
 * handler moves the path segment into `Authorization` and delegates to
 * `/api/mcp`'s own handler, so auth, gating, credits and transport behavior
 * cannot drift from the real endpoint.
 *
 * ⚠ Same function config as `/api/mcp` — this IS that route under a second
 * path, and the 300s ceiling is what keeps `dopl_channel(op="await")` alive.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ token: string }> };

async function withTokenHeader(
  request: Request,
  ctx: Ctx,
): Promise<Request> {
  const { token } = await ctx.params;
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  // Body is untouched and unread — the copy keeps the stream for the
  // transport. An invalid or expired token fails in `authenticateMcpRequest`
  // exactly as a bad header on /api/mcp would.
  return new Request(request, { headers });
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  return mcpPost(await withTokenHeader(request, ctx));
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  return mcpDelete(await withTokenHeader(request, ctx));
}

/** Stateless server, no standalone SSE stream — same 405 as /api/mcp. */
export function GET(): Response {
  return mcpGet();
}

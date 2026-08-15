import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * RFC 9728 Protected Resource Metadata for the MCP endpoint. ⚠ Served at
 * `/.well-known/oauth-protected-resource` via a REWRITE in next.config.ts — a normal API route
 * avoids Next's dot-directory routing ambiguity. `/api/mcp`'s `WWW-Authenticate` points here,
 * which triggers discovery → dynamic client registration → PKCE login.
 */
export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return NextResponse.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["dopl.read", "dopl.write"],
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}

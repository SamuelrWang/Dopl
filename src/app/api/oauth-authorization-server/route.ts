import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * RFC 8414 Authorization Server Metadata. ⚠ Served at
 * `/.well-known/oauth-authorization-server` via a REWRITE (next.config.ts). Clients arrive from
 * the protected-resource metadata, then run DCR + authorization-code/PKCE.
 * Public clients only (`token_endpoint_auth_method: none`), S256 PKCE required, refresh supported.
 */
export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      revocation_endpoint: `${origin}/api/oauth/revoke`,
      scopes_supported: ["dopl.read", "dopl.write"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}

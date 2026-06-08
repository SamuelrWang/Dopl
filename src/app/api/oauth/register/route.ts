import { NextRequest, NextResponse } from "next/server";
import { registerClient } from "@/shared/auth/mcp-oauth";

export const dynamic = "force-dynamic";

/**
 * RFC 7591 Dynamic Client Registration. MCP clients (Claude Desktop/.ai,
 * Cursor) POST their `redirect_uris` + `client_name` and get back a
 * `client_id`. Public clients only — no client secret.
 *
 * Registration is intentionally light; the real security controls are at
 * /authorize (exact redirect_uri match) and /token (PKCE). We only reject
 * cleartext-http redirect URIs on non-loopback hosts so tokens can't leak.
 */
function isAllowedRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol === "http:") {
      return (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]"
      );
    }
    // https or a native-app custom scheme (e.g. cursor://) — allowed.
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];

  if (redirectUris.length === 0) {
    return NextResponse.json(
      {
        error: "invalid_redirect_uri",
        error_description: "At least one redirect_uri is required.",
      },
      { status: 400 },
    );
  }
  // Size caps — registration is open (public clients), so bound the inputs.
  if (redirectUris.length > 20) {
    return NextResponse.json(
      {
        error: "invalid_redirect_uri",
        error_description: "Too many redirect_uris (max 20).",
      },
      { status: 400 },
    );
  }
  if (redirectUris.some((u) => u.length > 2048)) {
    return NextResponse.json(
      {
        error: "invalid_redirect_uri",
        error_description: "A redirect_uri exceeds the 2048-char limit.",
      },
      { status: 400 },
    );
  }
  for (const uri of redirectUris) {
    if (!isAllowedRedirect(uri)) {
      return NextResponse.json(
        {
          error: "invalid_redirect_uri",
          error_description: `Disallowed redirect_uri (cleartext http on a non-loopback host is not permitted): ${uri}`,
        },
        { status: 400 },
      );
    }
  }

  const client = await registerClient({
    client_name:
      typeof body.client_name === "string"
        ? body.client_name.slice(0, 255)
        : null,
    redirect_uris: redirectUris,
  });

  return NextResponse.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: client.grant_types,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

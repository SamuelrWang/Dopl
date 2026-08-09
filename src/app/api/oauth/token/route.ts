import { NextRequest, NextResponse } from "next/server";
import {
  getClient,
  consumeAuthCode,
  issueTokens,
  rotateRefreshToken,
  type IssuedTokens,
} from "@/shared/auth/mcp-oauth";
import { enforceOAuthIpRateLimit } from "@/shared/auth/oauth-rate-limit";

export const dynamic = "force-dynamic";

// Per-IP token ceiling. The auth codes / tokens here are 256-bit and single-use
// so unlike /register this endpoint mints nothing on a bad guess (it's
// cost-only), hence a higher bound than registration: a real client hits it on
// the code exchange and once per hour per token on refresh, so 60/min/IP covers
// even a busy multi-token NAT while still capping a brute-force sweep. Override
// via env.
const TOKEN_RPM = Number(process.env.OAUTH_TOKEN_RATE_LIMIT_RPM) || 60;

/**
 * OAuth 2.1 token endpoint. Supports:
 *   - grant_type=authorization_code (PKCE verifier required)
 *   - grant_type=refresh_token (rotating)
 *
 * Public clients, so no client authentication — the auth code is bound to
 * the client_id + redirect_uri + PKCE challenge at issuance and re-checked
 * here. Form-encoded per the OAuth spec.
 */
async function readParams(
  request: NextRequest,
): Promise<Record<string, string>> {
  const ct = request.headers.get("content-type") || "";
  // OAuth mandates form-encoding, but some MCP clients send JSON — accept both.
  if (ct.includes("application/json")) {
    try {
      const j = (await request.json()) as Record<string, unknown>;
      const o: Record<string, string> = {};
      for (const [k, v] of Object.entries(j)) {
        if (typeof v === "string") o[k] = v.trim();
      }
      return o;
    } catch {
      return {};
    }
  }
  try {
    const f = await request.formData();
    const o: Record<string, string> = {};
    for (const [k, v] of f.entries()) {
      if (typeof v === "string") o[k] = v.trim();
    }
    return o;
  } catch {
    return {};
  }
}

function tokenError(error: string, description: string, status: number) {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function tokenResponse(tokens: IssuedTokens) {
  return NextResponse.json(
    {
      access_token: tokens.access_token,
      token_type: "Bearer",
      expires_in: tokens.expires_in,
      refresh_token: tokens.refresh_token,
      scope: tokens.scopes.join(" "),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const limited = await enforceOAuthIpRateLimit(request, {
    bucket: "oauth-token-ip",
    rpm: TOKEN_RPM,
    endpoint: "POST /api/oauth/token",
  });
  if (limited) return limited;

  const params = await readParams(request);
  const grantType = params.grant_type ?? "";

  if (grantType === "authorization_code") {
    const code = params.code ?? "";
    const clientId = params.client_id ?? "";
    const redirectUri = params.redirect_uri ?? "";
    const codeVerifier = params.code_verifier ?? "";
    if (!code || !clientId || !redirectUri || !codeVerifier) {
      return tokenError(
        "invalid_request",
        "code, client_id, redirect_uri, and code_verifier are required.",
        400,
      );
    }
    const client = await getClient(clientId);
    if (!client) return tokenError("invalid_client", "Unknown client.", 401);

    const consumed = await consumeAuthCode({
      code,
      clientId,
      redirectUri,
      codeVerifier,
    });
    if (!consumed) {
      return tokenError(
        "invalid_grant",
        "Authorization code is invalid, expired, already used, or PKCE verification failed.",
        400,
      );
    }

    const tokens = await issueTokens({
      userId: consumed.userId,
      clientId,
      scopes: consumed.scopes,
      clientName: client.client_name,
    });
    return tokenResponse(tokens);
  }

  if (grantType === "refresh_token") {
    const refreshToken = params.refresh_token ?? "";
    const clientId = params.client_id ?? "";
    if (!refreshToken || !clientId) {
      return tokenError(
        "invalid_request",
        "refresh_token and client_id are required.",
        400,
      );
    }
    const rotated = await rotateRefreshToken({ refreshToken, clientId });
    if (!rotated) {
      return tokenError(
        "invalid_grant",
        "Refresh token is invalid, expired, revoked, or already rotated.",
        400,
      );
    }
    return tokenResponse(rotated);
  }

  return tokenError(
    "unsupported_grant_type",
    "Only authorization_code and refresh_token are supported.",
    400,
  );
}

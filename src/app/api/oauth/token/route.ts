import { NextRequest, NextResponse } from "next/server";
import {
  getClient,
  consumeAuthCode,
  issueTokens,
  rotateRefreshToken,
  type IssuedTokens,
} from "@/shared/auth/mcp-oauth";

export const dynamic = "force-dynamic";

/**
 * OAuth 2.1 token endpoint. Supports:
 *   - grant_type=authorization_code (PKCE verifier required)
 *   - grant_type=refresh_token (rotating)
 *
 * Public clients, so no client authentication — the auth code is bound to
 * the client_id + redirect_uri + PKCE challenge at issuance and re-checked
 * here. Form-encoded per the OAuth spec.
 */
function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
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
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return tokenError("invalid_request", "Expected form-encoded body.", 400);
  }

  const grantType = str(form.get("grant_type"));

  if (grantType === "authorization_code") {
    const code = str(form.get("code"));
    const clientId = str(form.get("client_id"));
    const redirectUri = str(form.get("redirect_uri"));
    const codeVerifier = str(form.get("code_verifier"));
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
    const refreshToken = str(form.get("refresh_token"));
    const clientId = str(form.get("client_id"));
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

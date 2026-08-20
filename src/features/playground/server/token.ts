import "server-only";
import {
  ACCESS_PREFIX,
  MCP_SCOPES,
  randToken,
  sha256,
} from "@/shared/auth/mcp-oauth";
import {
  PLAYGROUND_CLIENT_ID,
  PLAYGROUND_CLIENT_NAME,
} from "@/shared/auth/mcp-credential";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Mint a short-lived playground guest token — `issueDeviceToken`'s shape
 * (`shared/auth/mcp-oauth.ts`) under the reserved playground client: same
 * `mcp_tokens` storage + `validateAccessToken` path, no refresh token (a
 * guest session is never renewed — it expires and is reaped), full read+write
 * scopes so the demo can exercise the whole surface. Lives here rather than
 * in mcp-oauth.ts because that file sits against the 500-line cap and this is
 * a playground concern; the hash/rand/prefix primitives are imported from it,
 * so the row stays validate-compatible by construction.
 */
export async function issuePlaygroundToken(input: {
  userId: string;
  ttlSeconds: number;
}): Promise<{ token: string; expiresAt: string }> {
  const db = supabaseAdmin();
  // `mcp_tokens.client_id` is a NOT NULL FK to `oauth_clients` — the reserved
  // row must exist first (same pattern as `ensureDeviceClient`).
  const { error: clientError } = await db.from("oauth_clients").upsert(
    {
      client_id: PLAYGROUND_CLIENT_ID,
      client_name: PLAYGROUND_CLIENT_NAME,
      redirect_uris: [],
    },
    { onConflict: "client_id", ignoreDuplicates: true },
  );
  if (clientError) throw clientError;

  const accessToken = randToken(ACCESS_PREFIX);
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
  const { error } = await db.from("mcp_tokens").insert({
    user_id: input.userId,
    client_id: PLAYGROUND_CLIENT_ID,
    access_token_hash: sha256(accessToken),
    refresh_token_hash: null,
    scopes: [...MCP_SCOPES],
    access_expires_at: expiresAt,
    refresh_expires_at: null,
    client_name: PLAYGROUND_CLIENT_NAME,
  });
  if (error) throw error;
  return { token: accessToken, expiresAt };
}

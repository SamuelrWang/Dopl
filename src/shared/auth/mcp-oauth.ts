import "server-only";
import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * mcp-oauth — core of Dopl's self-built OAuth 2.1 authorization server for the
 * remote MCP endpoint. Lives in shared/auth (alongside api-keys.ts) because
 * `validateAccessToken` is consumed by BOTH auth points — the MCP transport
 * boundary (with-mcp-transport-auth.ts) and the loopback /api/* guard
 * (with-auth.ts) — and shared/ must not import from features/.
 *
 * Security model:
 *   - Only SHA-256 hashes of codes/tokens are stored; plaintext is returned
 *     once at issuance and never persisted.
 *   - Authorization codes are single-use (atomic consume) + PKCE-S256 bound.
 *   - Access tokens are short-lived; refresh tokens rotate (reuse ⇒ reject).
 *   - All DB access is via the service role (supabaseAdmin); the tables have
 *     RLS enabled with no policies.
 */

export const MCP_SCOPES = ["dopl.read", "dopl.write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

const ACCESS_PREFIX = "dopl_at_";
const REFRESH_PREFIX = "dopl_rt_";
const CODE_PREFIX = "dopl_ac_";
const CLIENT_PREFIX = "dopl_client_";

export const ACCESS_TTL_S = 60 * 60; // 1 hour
const REFRESH_TTL_S = 60 * 60 * 24 * 30; // 30 days
const CODE_TTL_S = 5 * 60; // 5 minutes

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function randToken(prefix: string): string {
  return prefix + randomBytes(32).toString("hex");
}

/** Is this string an OAuth access token (vs an sk-dopl- API key)? */
export function isOAuthAccessToken(token: string): boolean {
  return token.startsWith(ACCESS_PREFIX);
}

/** Constant-time PKCE S256 check: base64url(sha256(verifier)) === challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  if (computed.length !== challenge.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ challenge.charCodeAt(i);
  }
  return diff === 0;
}

// ── Clients (Dynamic Client Registration) ────────────────────────────

export interface OAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: string;
}

export async function registerClient(input: {
  client_name?: string | null;
  redirect_uris: string[];
}): Promise<OAuthClient> {
  const db = supabaseAdmin();
  const row: OAuthClient = {
    client_id: randToken(CLIENT_PREFIX),
    client_name: input.client_name ?? null,
    redirect_uris: input.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
  };
  const { error } = await db.from("oauth_clients").insert(row);
  if (error) throw error;
  return row;
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("oauth_clients")
    .select(
      "client_id, client_name, redirect_uris, grant_types, token_endpoint_auth_method",
    )
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !data) return null;
  return data as OAuthClient;
}

// ── Authorization codes (PKCE, single-use) ────────────────────────────

export async function issueAuthCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
}): Promise<string> {
  const db = supabaseAdmin();
  const code = randToken(CODE_PREFIX);
  const { error } = await db.from("oauth_authorization_codes").insert({
    code_hash: sha256(code),
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    scopes: input.scopes,
    expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
  });
  if (error) throw error;
  return code;
}

/**
 * Validate + atomically consume an authorization code. Returns the bound
 * identity/scopes, or null on any failure (unknown, expired, replayed,
 * client/redirect mismatch, or PKCE failure). Single-use is enforced by the
 * conditional `consumed_at IS NULL` update — a concurrent second exchange
 * loses the race and gets null.
 */
export async function consumeAuthCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ userId: string; scopes: string[] } | null> {
  const db = supabaseAdmin();
  const codeHash = sha256(input.code);
  const { data, error } = await db
    .from("oauth_authorization_codes")
    .select(
      "client_id, user_id, redirect_uri, code_challenge, scopes, expires_at, consumed_at",
    )
    .eq("code_hash", codeHash)
    .maybeSingle();
  if (error || !data) return null;
  if (data.consumed_at) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  if (data.client_id !== input.clientId) return null;
  if (data.redirect_uri !== input.redirectUri) return null;
  if (!verifyPkceS256(input.codeVerifier, data.code_challenge)) return null;

  const { data: claimed, error: claimErr } = await db
    .from("oauth_authorization_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .select("code_hash");
  if (claimErr || !claimed || claimed.length === 0) return null;

  return { userId: data.user_id, scopes: data.scopes };
}

// ── Tokens ────────────────────────────────────────────────────────────

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scopes: string[];
}

export async function issueTokens(input: {
  userId: string;
  clientId: string;
  scopes: string[];
  clientName?: string | null;
}): Promise<IssuedTokens> {
  const db = supabaseAdmin();
  const accessToken = randToken(ACCESS_PREFIX);
  const refreshToken = randToken(REFRESH_PREFIX);
  const now = Date.now();
  const { error } = await db.from("mcp_tokens").insert({
    user_id: input.userId,
    client_id: input.clientId,
    access_token_hash: sha256(accessToken),
    refresh_token_hash: sha256(refreshToken),
    scopes: input.scopes,
    access_expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString(),
    refresh_expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString(),
    client_name: input.clientName ?? null,
  });
  if (error) throw error;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TTL_S,
    scopes: input.scopes,
  };
}

/**
 * Resolve an access token to an identity. The single validation entry point
 * used by the MCP transport boundary AND the loopback /api/* guard. Returns
 * null for non-tokens, unknown/expired/revoked tokens. Touches last_used_at
 * fire-and-forget.
 */
export async function validateAccessToken(
  token: string,
): Promise<{ userId: string; scopes: string[]; tokenId: string } | null> {
  if (!isOAuthAccessToken(token)) return null;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("mcp_tokens")
    .select("id, user_id, scopes, access_expires_at, revoked_at")
    .eq("access_token_hash", sha256(token))
    .maybeSingle();
  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (new Date(data.access_expires_at).getTime() < Date.now()) return null;

  void db
    .from("mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(
      () => {},
      () => {},
    );

  return { userId: data.user_id, scopes: data.scopes, tokenId: data.id };
}

/**
 * Rotate a refresh token: revoke the presented one and issue a fresh pair.
 * Reuse of an already-rotated refresh token returns null (the conditional
 * revoke loses the race / finds it already revoked).
 */
export async function rotateRefreshToken(input: {
  refreshToken: string;
  clientId: string;
}): Promise<IssuedTokens | null> {
  if (!input.refreshToken.startsWith(REFRESH_PREFIX)) return null;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("mcp_tokens")
    .select(
      "id, user_id, client_id, scopes, refresh_expires_at, revoked_at, client_name",
    )
    .eq("refresh_token_hash", sha256(input.refreshToken))
    .maybeSingle();
  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (data.client_id !== input.clientId) return null;
  if (
    data.refresh_expires_at &&
    new Date(data.refresh_expires_at).getTime() < Date.now()
  ) {
    return null;
  }

  const { data: revoked } = await db
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", data.id)
    .is("revoked_at", null)
    .select("id");
  if (!revoked || revoked.length === 0) return null;

  return issueTokens({
    userId: data.user_id,
    clientId: data.client_id,
    scopes: data.scopes,
    clientName: data.client_name,
  });
}

/** RFC 7009 revocation — accepts either an access or refresh token. */
export async function revokeToken(token: string): Promise<void> {
  const db = supabaseAdmin();
  const hash = sha256(token);
  const now = new Date().toISOString();
  await db
    .from("mcp_tokens")
    .update({ revoked_at: now })
    .eq("access_token_hash", hash)
    .is("revoked_at", null);
  await db
    .from("mcp_tokens")
    .update({ revoked_at: now })
    .eq("refresh_token_hash", hash)
    .is("revoked_at", null);
}

// ── Settings: connected apps ──────────────────────────────────────────

export interface McpGrant {
  id: string;
  client_name: string | null;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
}

export async function listUserGrants(userId: string): Promise<McpGrant[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("mcp_tokens")
    .select("id, client_name, scopes, last_used_at, created_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as McpGrant[];
}

/** Revoke a single grant by id, scoped to its owner. */
export async function revokeGrant(id: string, userId: string): Promise<void> {
  const db = supabaseAdmin();
  await db
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
}

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Bearer Supabase-JWT verification for `withUserAuth`. The bundled SPA's main
 * process holds the session and presents the access JWT as
 * `Authorization: Bearer <jwt>`; a valid one is a SESSION caller with
 * cookie-identical semantics.
 */

/** Bare (cookie-less) client. ⚠ Lazy singleton so auth-js's JWKS cache is
 *  shared process-wide. */
let _jwtClient: SupabaseClient | null = null;
function jwtClient(): SupabaseClient {
  if (!_jwtClient) {
    _jwtClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _jwtClient;
}

/**
 * Verify a Supabase access JWT presented as a Bearer credential. Same authority
 * as `getSessionUser`: `getClaims(jwt)` verifies the signature locally against
 * the cached ES256 JWKS, nothing trusted on decode alone.
 * ⚠ Same load-bearing try/catch — auth-js re-throws plain Errors for
 * expired/malformed tokens, and every road must end at null → 401, never 500.
 */
export async function getBearerJwtUser(token: string): Promise<{ id: string } | null> {
  // ⚠ PRE-CHECK before getClaims: auth-js falls back to a NETWORK `getUser()`
  // whenever the (unsigned) header lacks a `kid` or claims an HS* alg, so any
  // junk bearer would buy an unauthenticated /auth/v1/user round-trip. Only a
  // well-formed ES256+kid token may reach local JWKS verification.
  if (!isEs256JwtWithKid(token)) return null;
  try {
    const { data } = await jwtClient().auth.getClaims(token);
    const sub = data?.claims?.sub;
    return typeof sub === "string" && sub.length > 0 ? { id: sub } : null;
  } catch {
    return null;
  }
}

/** Structural check only: three segments, `alg` exactly "ES256", `kid` present.
 *  ⚠ Signature verification happens in getClaims; this decides only whether
 *  getClaims may be consulted at all. */
function isEs256JwtWithKid(token: string): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0]) return false;
  try {
    const header = JSON.parse(
      Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    ) as { alg?: unknown; kid?: unknown };
    return (
      header.alg === "ES256" &&
      typeof header.kid === "string" &&
      header.kid.length > 0
    );
  } catch {
    return false;
  }
}

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Bearer Supabase-JWT verification for `withUserAuth` (desktop migration
 * Phase 2 — see docs/migration-research/auth-flows.md). The bundled
 * desktop SPA's main process holds the Supabase session and presents the
 * access JWT as `Authorization: Bearer <jwt>`; a valid one is a SESSION
 * caller with cookie-identical semantics. Split from with-auth.ts for the
 * 500-line cap (§2).
 */

/** Bare (cookie-less) client for verifying bearer Supabase JWTs. Lazy
 *  singleton so the JWKS cache inside auth-js is shared process-wide. */
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
 * Verify a Supabase access JWT presented as a Bearer credential (the
 * bundled desktop SPA path). Same verification authority as
 * `getSessionUser` — `getClaims(jwt)` checks the signature locally against
 * the cached ES256 JWKS; nothing is trusted on decode alone — and the same
 * load-bearing try/catch: auth-js re-throws plain Errors for expired/
 * malformed tokens, and every road must end at null → 401, never a 500.
 */
export async function getBearerJwtUser(token: string): Promise<{ id: string } | null> {
  // PRE-CHECK before getClaims: auth-js falls back to a NETWORK
  // `getUser()` against this project's GoTrue whenever the (unsigned)
  // header lacks a `kid` or claims an HS* alg — meaning any junk bearer
  // would buy an unauthenticated /auth/v1/user round-trip, the exact
  // amplifier Q11 exists to prevent. Only a well-formed ES256+kid token —
  // the only shape this project's GoTrue mints — may proceed to local
  // JWKS verification. Everything else is rejected here for free.
  if (!isEs256JwtWithKid(token)) return null;
  try {
    const { data } = await jwtClient().auth.getClaims(token);
    const sub = data?.claims?.sub;
    return typeof sub === "string" && sub.length > 0 ? { id: sub } : null;
  } catch {
    return null;
  }
}

/** Cheap structural check on the JWT header: three segments, `alg` exactly
 *  "ES256", `kid` present. Signature verification happens in getClaims —
 *  this only decides whether getClaims may be consulted at all. */
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

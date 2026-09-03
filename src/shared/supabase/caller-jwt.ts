import "server-only";
import { createHmac } from "node:crypto";
import type { CallerScope } from "./caller-scope";

/**
 * A SHORT-LIVED SUPABASE JWT FOR ONE CALLER — RLS plan phase 3, option 1
 * ("mint a JWT signed with the project JWT secret; policies keyed on
 * `auth.uid()` work unchanged for BOTH lanes"), taken because the remote-MCP
 * lane authenticates with our own `dopl_at_` tokens and has no GoTrue session
 * to borrow a JWT from.
 *
 * 🔒 ⚠ ONE MINT FOR EVERY LANE, ON PURPOSE. A cookie session already holds a
 * GoTrue access token this server could forward instead — and forwarding it for
 * web callers while minting for MCP callers would mean two token shapes, two
 * claim sets and two ways for a policy to be right about one of them. Every
 * caller-scoped read runs on a token minted HERE, so `auth.jwt()` has exactly
 * one shape and the credential axes are always present.
 *
 * ⚠ THE TTL IS A REQUEST, NOT A SESSION. 60 seconds: long enough that one
 * request never outlives its own token, short enough that a leaked one is worth
 * nothing. Nothing persists it; it is an `Authorization` header on a client that
 * lives in a Map for less than a minute (`caller-client.ts`).
 *
 * ⚠ HS256 AGAINST THE LEGACY PROJECT SECRET. Supabase projects that have moved
 * to asymmetric (ES256) signing keys still accept the legacy shared secret until
 * it is revoked; a project that HAS revoked it needs this module repointed at
 * the project's signing key, not a second code path. `SUPABASE_JWT_SECRET` is a
 * NEW deploy input for this repo — with `RLS_CALLER_SCOPED_READS` off (the
 * default) nothing reads it, and with the flag on a missing secret THROWS rather
 * than falling back to the service role, because a silent fallback is a fence
 * that reports itself armed while doing nothing.
 */

/** Env var holding the project's JWT secret. ⚠ Never `NEXT_PUBLIC_`. */
export const SUPABASE_JWT_SECRET_ENV = "SUPABASE_JWT_SECRET";

/** Seconds a minted caller token is valid for. */
export const CALLER_JWT_TTL_SECONDS = 60;

/**
 * Namespaced claim carrying the credential axes.
 * ⚠ THE STRING IS THE CONTRACT — the SQL side reads it in
 * `dopl_credential_is_shared()` (`20260919120000_rls_helpers_and_caller_scope`).
 * Changing it here without changing the function silently un-shares every shared
 * credential, because an ABSENT claim reads as "not shared" (below).
 */
export const DOPL_CREDENTIAL_CLAIM = "dopl_credential";

export interface CallerJwtClaims {
  sub: string;
  role: "authenticated";
  aud: "authenticated";
  iat: number;
  exp: number;
  [DOPL_CREDENTIAL_CLAIM]: {
    /**
     * ⚠ ABSENT READS AS `false` ON THE SQL SIDE, and that is correct rather
     * than lax: the only token that can reach a policy without this claim is a
     * GoTrue session token, and a session IS a person
     * (`credential-audience.ts › isSharedCredential`: no lock → false). Every
     * token minted here states the axis explicitly.
     */
    shared: boolean;
    workspace_id: string | null;
  };
}

/** The claim set for one caller at one instant. Pure — the test drives `now`. */
export function callerJwtClaims(scope: CallerScope, nowSeconds: number): CallerJwtClaims {
  return {
    sub: scope.userId,
    // PostgREST reads `role` to SET ROLE for the statement. `authenticated` is
    // the role every policy in this schema is written against; `service_role`
    // would bypass RLS and defeat the entire slice.
    role: "authenticated",
    aud: "authenticated",
    iat: nowSeconds,
    exp: nowSeconds + CALLER_JWT_TTL_SECONDS,
    [DOPL_CREDENTIAL_CLAIM]: {
      shared: scope.sharedCredential,
      workspace_id: scope.credentialWorkspaceId,
    },
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Sign the caller's claims. ⚠ `node:crypto` rather than a JWT library: HS256 is
 * one HMAC over two base64url segments, and a dependency here would be a new
 * lockfile entry on the security path for ten lines of code.
 */
export function signCallerJwt(
  scope: CallerScope,
  opts: { env?: Record<string, string | undefined>; nowSeconds?: number } = {}
): string {
  const secret = (opts.env ?? process.env)[SUPABASE_JWT_SECRET_ENV];
  if (!secret) {
    throw new Error(
      `${SUPABASE_JWT_SECRET_ENV} is required for caller-scoped reads. Unset it and RLS_CALLER_SCOPED_READS together, or set both.`
    );
  }
  const nowSeconds = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(callerJwtClaims(scope, nowSeconds)));
  const signature = base64url(
    createHmac("sha256", secret).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${signature}`;
}

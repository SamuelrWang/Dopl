import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./admin";
import { getCallerScope, type CallerScope } from "./caller-scope";
import { CALLER_JWT_TTL_SECONDS, signCallerJwt } from "./caller-jwt";

/**
 * THE READ CLIENT — one function every knowledge read calls instead of
 * `supabaseAdmin()`, and the single place the RLS phase-1 flag is honoured
 * (Wave B B7, RLS plan phases 2–3).
 *
 * 🔒 ⚠ WHAT CHANGES WHEN THE FLAG IS ON: the row filter moves into Postgres.
 * The service-role client bypasses RLS entirely, so every policy this repo has
 * ever written is inert on those paths and each visibility rule is stated TWICE
 * — once as a TS predicate that is the real fence, once as a policy that runs
 * nowhere. A caller-scoped client makes the policy the fence; the TS predicate
 * stays until the flag has been on for a release (Samuel's ruling B5, spec
 * §5 B7: "No TS predicate deleted"), so with the flag OFF this file is a
 * pass-through to `supabaseAdmin()` and nothing about today's behaviour moves.
 *
 * ⚠ NOT EVERY READ BELONGS HERE. A read that answers a SYSTEM question — slug
 * uniqueness, storage accounting, a seed-gate count — must keep the service role
 * or it starts answering "…that this caller can see", which is a different and
 * wrong question. Each such call site says so at the call site.
 */

/**
 * ⚠ OPT-IN, AND THE ABSENT VALUE IS THE SAFE ONE. Mirror-image of
 * `website-retirement.ts › isWebsiteRetired` (where absent means ON because the
 * safe state is retired): here the safe state is today's behaviour, so anything
 * that is not an explicit spelling of ON leaves the service-role path alone.
 */
export const RLS_CALLER_SCOPED_READS_ENV = "RLS_CALLER_SCOPED_READS";

const ON_VALUES = new Set(["1", "true", "on"]);

/** ⚠ Read PER CALL, never captured at module load — flipping the flag must need
 *  no redeploy, and no cached client may outlive the flip (see the cache TTL). */
export function callerScopedReadsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env[RLS_CALLER_SCOPED_READS_ENV];
  if (typeof raw !== "string") return false;
  return ON_VALUES.has(raw.trim().toLowerCase());
}

interface CachedClient {
  client: SupabaseClient;
  expiresAtMs: number;
}

/**
 * One client per (caller × credential axes) for the life of its token.
 * ⚠ Keyed on the whole scope, never on the user id alone: the same person
 * arriving on a SHARED credential is a different reader, and handing them a
 * cached client minted from their own session's claims would hand a shared
 * credential the operator's private rows — the exact confusion F-336 is about.
 */
const clientCache = new Map<string, CachedClient>();

/** Re-mint this long before `exp` so a slow request cannot outlive its token. */
const REFRESH_MARGIN_MS = 10_000;

function cacheKey(scope: CallerScope): string {
  return `${scope.userId}|${scope.sharedCredential ? "1" : "0"}|${scope.credentialWorkspaceId ?? ""}`;
}

/**
 * A Postgres client that runs as the caller — the anon key plus a minted JWT, so
 * `auth.uid()`, `auth.jwt()` and every policy on the table apply.
 * ⚠ `persistSession: false` — nothing about this client is a session; it is one
 * `Authorization` header with a 60-second life.
 */
export function callerScopedClient(scope: CallerScope): SupabaseClient {
  const key = cacheKey(scope);
  const now = Date.now();
  const hit = clientCache.get(key);
  if (hit && hit.expiresAtMs > now) return hit.client;

  // Sweep on miss — the map is per-process and unbounded otherwise.
  for (const [k, v] of clientCache) if (v.expiresAtMs <= now) clientCache.delete(k);

  const token = signCallerJwt(scope);
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  );
  clientCache.set(key, {
    client,
    expiresAtMs: now + CALLER_JWT_TTL_SECONDS * 1000 - REFRESH_MARGIN_MS,
  });
  return client;
}

/**
 * The client a VISIBILITY-BEARING read should use.
 *
 * Flag off, or no request scope (cron, ingestion, a script): the service-role
 * client, verbatim today's behaviour. Flag on inside a request: the caller's own
 * client, where the policy decides which rows exist.
 */
export function readClient(): SupabaseClient {
  if (!callerScopedReadsEnabled()) return supabaseAdmin();
  const scope = getCallerScope();
  if (!scope) return supabaseAdmin();
  return callerScopedClient(scope);
}

/** ⚠ Test seam only — the cache is keyed on a JWT that a test may re-mint. */
export function __resetCallerClientCacheForTests(): void {
  clientCache.clear();
}

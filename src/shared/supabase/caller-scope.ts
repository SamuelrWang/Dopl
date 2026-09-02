import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * WHO THE REQUEST IS, carried to the repository layer without a signature
 * change on 406 read sites (RLS plan phase 2 / Wave B B7).
 *
 * 🔒 ⚠ THIS IS THE ONLY INPUT TO A CALLER-SCOPED POSTGRES CLIENT, AND EVERY
 * FIELD OF IT IS SERVER-DERIVED. `with-auth.ts` builds it from the credential it
 * has ALREADY validated — a Supabase session claim, a bearer JWT verified
 * against the JWKS, or a `dopl_at_` row read out of `mcp_tokens`. Nothing here
 * may ever be read off a header: `X-Workspace-Id`, `X-Dopl-Runtime` and
 * `X-Dopl-Session-Id` are documented NON-authorization signals (INVARIANTS §10)
 * and a device-token holder can send any value for all three.
 *
 * ⚠ WHY AsyncLocalStorage RATHER THAN A PARAMETER. The RLS plan's phase 2 asks
 * for an `AccessContext` at the repository boundary; the repositories reach for
 * `supabaseAdmin()` INLINE and take no client, so threading one would be a
 * whole-tree edit landing in the same change as the first policy. The store is
 * request-scoped, set once at the auth wrapper every API route already composes,
 * and read at exactly one place (`caller-client.ts › readClient`). A read that
 * runs OUTSIDE a request (cron, ingestion, a script) finds no scope and keeps
 * the service-role client, which is the correct answer for a system path.
 */

export interface CallerScope {
  /** `auth.uid()` for the minted JWT — the Supabase user id, never a token id. */
  userId: string;
  /**
   * Does this credential stand for NOBODY IN PARTICULAR?
   * ⚠ The value of `credential-audience.ts › isSharedCredential`, computed by
   * the auth wrapper and carried, never re-derived here: this module must not
   * grow a second copy of the M-10 predicate.
   */
  sharedCredential: boolean;
  /**
   * `mcp_tokens.workspace_id` — WHICH workspace the credential is fenced to, or
   * `null` for an ordinary session. Carried for the credential axes B3 splits;
   * the policies do not read it today (workspace membership is re-derived from
   * the database by `is_current_workspace_member`, which no claim can widen).
   */
  credentialWorkspaceId: string | null;
}

const scopeStore = new AsyncLocalStorage<CallerScope>();

/** Run `fn` with `scope` visible to every read underneath it, awaits included. */
export function runWithCallerScope<T>(scope: CallerScope, fn: () => T): T {
  return scopeStore.run(scope, fn);
}

/** The current request's scope, or `null` outside a request. */
export function getCallerScope(): CallerScope | null {
  return scopeStore.getStore() ?? null;
}

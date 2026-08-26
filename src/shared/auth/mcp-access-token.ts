import "server-only";
import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { describeCredential, type McpCredential } from "./mcp-credential";

/**
 * ACCESS-TOKEN PRIMITIVES + THE ROW READ-BACK — split out of `mcp-oauth.ts` on
 * 2026-08-27, and the reason is a RESPONSIBILITY rather than a line count (§1).
 * That file ISSUES credentials (clients, auth codes, token pairs, device tokens,
 * rotation, revocation). This one holds the token's SHAPE and the single read
 * that turns a presented token back into an identity — including the two
 * AUTHORIZATION-BEARING fields on the row (`workspaceId`, `workspaceLockKind`),
 * which are now the reason this code changes most often. `mcp-oauth.ts` was at
 * 497 lines with an authorization field to add, and §1's rule for that is
 * "split, do not squeeze".
 *
 * ⚠ `mcp-oauth.ts` RE-EXPORTS EVERYTHING HERE, so every importer — and every
 * `vi.mock("@/shared/auth/mcp-oauth")` in the suite — keeps working unchanged.
 * The dependency runs ONE WAY (`mcp-oauth` → this file) so there is no cycle;
 * do not import from `mcp-oauth.ts` here.
 */

export const ACCESS_PREFIX = "dopl_at_";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randToken(prefix: string): string {
  return prefix + randomBytes(32).toString("hex");
}

/** Dopl OAuth access token? (`dopl_at_` prefix) */
export function isOAuthAccessToken(token: string): boolean {
  return token.startsWith(ACCESS_PREFIX);
}

// Per-instance debounce so a hot token doesn't write last_used_at every request
// (mirrors touchMcpStatus). At most one write/min/token/instance.
const lastUsedTouched = new Map<string, number>();
const LAST_USED_TOUCH_MS = 60_000;

/**
 * Resolve an access token to an identity. Single validation entry point for the
 * MCP transport boundary AND the loopback /api/* guard. Null for non-tokens and
 * unknown/expired/revoked tokens. Touches last_used_at fire-and-forget.
 *
 * ⚠ `credential` is DESCRIPTIVE only — nothing gates on it, and the label inside
 * is caller-supplied text (`mcp-credential.ts`).
 *
 * 🔒 ⚠ `workspaceId` AND `workspaceLockKind` ARE THE OPPOSITE: THEY ARE THE ONLY
 * FIELDS HERE THAT GATE, AND THEY GATE DIFFERENT AXES. `workspaceId` non-null
 * LOCKS this credential to that workspace (§4 step 1). `workspaceLockKind` says
 * WHAT KIND of lock it is, which is what `credential-audience.ts ›
 * isSharedCredential` reads to decide whether a single human stands behind the
 * credential — the question the M-10 visibility gates actually mean to ask.
 * `shared/auth/mcp-container-token.ts` mints both and carries the argument.
 *
 * ⚠ BOTH MUST STAY IN THIS SELECT, AND THEY FAIL IN OPPOSITE DIRECTIONS.
 * Dropping `workspace_id` makes every locked credential read as UNLOCKED —
 * silent, and it OPENS a fence. Dropping `workspace_lock_kind` makes every
 * container session read as a SHARED credential — also silent, but it CLOSES
 * one, so the tell is an operator's agent 404ing on their own knowledge base.
 */
export async function validateAccessToken(
  token: string,
): Promise<{
  userId: string;
  scopes: string[];
  tokenId: string;
  credential: McpCredential;
  workspaceId: string | null;
  workspaceLockKind: string | null;
} | null> {
  if (!isOAuthAccessToken(token)) return null;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("mcp_tokens")
    .select(
      "id, user_id, scopes, access_expires_at, revoked_at, client_id, client_name, workspace_id, workspace_lock_kind",
    )
    .eq("access_token_hash", sha256(token))
    .maybeSingle();
  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (new Date(data.access_expires_at).getTime() < Date.now()) return null;

  const now = Date.now();
  if (now - (lastUsedTouched.get(data.id) ?? 0) > LAST_USED_TOUCH_MS) {
    lastUsedTouched.set(data.id, now);
    void db
      .from("mcp_tokens")
      .update({ last_used_at: new Date(now).toISOString() })
      .eq("id", data.id)
      .then(
        () => {},
        () => {},
      );
  }

  const row = data as {
    workspace_id?: string | null;
    workspace_lock_kind?: string | null;
  };
  const credential = describeCredential(data.client_id, data.client_name);
  return {
    userId: data.user_id,
    scopes: data.scopes,
    tokenId: data.id,
    credential,
    // ⚠ `?? null` = "no lock stated". NOT a fail-open: unlocked is the ordinary
    // case, and the narrowing is only ever ADDED by a deliberate mint.
    workspaceId: row.workspace_id ?? null,
    // ⚠ `?? null` HERE IS THE FAIL-CLOSED DIRECTION: a lock with no stated kind
    // reads as a SHARED credential, which is the pre-2026-08-27 refusal verbatim.
    workspaceLockKind: row.workspace_lock_kind ?? null,
  };
}

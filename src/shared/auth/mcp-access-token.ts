import "server-only";
import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { CONTAINER_SESSION_LOCK } from "./credential-audience";
import { describeCredential, type McpCredential } from "./mcp-credential";

/**
 * ACCESS-TOKEN PRIMITIVES + THE ROW READ-BACK — split out of `mcp-oauth.ts` on
 * 2026-08-27, and the reason is a RESPONSIBILITY rather than a line count (§1).
 * That file ISSUES credentials (clients, auth codes, token pairs, device tokens,
 * rotation, revocation). This one holds the token's SHAPE and the single read
 * that turns a presented token back into an identity — including the two
 * AUTHORIZATION-BEARING AXES on the row (`containerId`, `subjectUserId`), which
 * are the reason this code changes most often. `mcp-oauth.ts` was at
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

/** Identity + expiry. Everything the boundary needs that is not an axis. */
const TOKEN_COLS =
  "id, user_id, scopes, access_expires_at, revoked_at, client_id, client_name";
/**
 * 🔒 THE LEGACY AXIS PAIR, AND IT IS ON *BOTH* SELECTS. Dropping it from the
 * fallback would make every fenced credential read as unfenced against a
 * pre-migration database — the fence-OPENING direction. Retires with B13.
 */
const LEGACY_AXIS_COLS = "workspace_id, workspace_lock_kind";
/** The two axes (`20260917120000_mcp_token_credential_axes`). */
const AXIS_COLS = "container_id, subject_user_id";
/** PostgREST surfaces Postgres `undefined_column` verbatim. */
const UNDEFINED_COLUMN = "42703";

interface TokenRow {
  id: string;
  user_id: string;
  scopes: string[];
  access_expires_at: string;
  revoked_at: string | null;
  client_id: string;
  client_name: string | null;
  workspace_id?: string | null;
  workspace_lock_kind?: string | null;
  container_id?: string | null;
  subject_user_id?: string | null;
}

/** Flips false the first time the axis columns answer 42703; see readTokenRow. */
let axisColumnsPresent = true;

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
 * 🔒 ⚠ `containerId` AND `subjectUserId` ARE THE OPPOSITE: THEY ARE THE ONLY
 * FIELDS HERE THAT GATE, AND THEY GATE DIFFERENT AXES. `containerId` non-null
 * fences this credential to that container (§4 step 1). `subjectUserId` names
 * the ONE human it acts as, and `null` means nobody in particular — the question
 * the M-10 visibility gates actually mean to ask, answered through
 * `credential-audience.ts › isSharedCredential`. They are INDEPENDENT: a
 * credential may be fenced and personal, fenced and anonymous, or unfenced and
 * personal. `shared/auth/mcp-container-token.ts` mints both.
 *
 * ⚠ BOTH FAIL IN OPPOSITE DIRECTIONS. Losing the container axis makes every
 * fenced credential read as UNFENCED — silent, and it OPENS a fence. Losing the
 * subject axis makes every session read as a SHARED credential — also silent,
 * but it CLOSES one, so the tell is an operator's agent 404ing on their own
 * knowledge base.
 *
 * ⚠ DUAL-READ FOR ONE RELEASE, IN BOTH SENSES, AND IT RETIRES WITH B13.
 * (1) A row the backfill has not reached derives both axes from the legacy pair
 * (`workspace_id` + `workspace_lock_kind`) through {@link legacyAxes} — the same
 * mapping `20260917120000_mcp_token_credential_axes` writes, so the two sources
 * cannot disagree. (2) A DATABASE the migration has not reached answers 42703
 * for the new columns; that is caught once per process and the legacy column
 * list is used from then on. Without (2) shipping this file ahead of its
 * migration would 401 every credential at once — the `20260825150000` trap
 * (INVARIANTS §12), on the one table where it is total rather than per-feature.
 */
export async function validateAccessToken(
  token: string,
): Promise<{
  userId: string;
  scopes: string[];
  tokenId: string;
  credential: McpCredential;
  /** WHICH container this credential may act in; `null` = unfenced. */
  containerId: string | null;
  /** WHOSE reach it inherits; `null` = nobody in particular (M-10). */
  subjectUserId: string | null;
} | null> {
  if (!isOAuthAccessToken(token)) return null;
  const data = await readTokenRow(sha256(token));
  if (!data) return null;
  if (data.revoked_at) return null;
  if (new Date(data.access_expires_at).getTime() < Date.now()) return null;

  const db = supabaseAdmin();
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

  const legacy = legacyAxes(data);
  return {
    userId: data.user_id,
    scopes: data.scopes,
    tokenId: data.id,
    credential: describeCredential(data.client_id, data.client_name),
    // ⚠ `?? legacy` = "this row predates the backfill". NOT a fail-open on
    // either axis: the fallback IS the backfill's own mapping, so an upgraded
    // row and a legacy row answer identically.
    containerId: data.container_id ?? legacy.containerId,
    subjectUserId: data.subject_user_id ?? legacy.subjectUserId,
  };
}

/**
 * The legacy pair, mapped onto the two axes — the mapping
 * `20260917120000_mcp_token_credential_axes`'s backfill writes into the columns,
 * stated once so the fallback and the migration cannot drift.
 *
 * 🔒 Unfenced OR a container session ⇒ a person stands behind it. Anything else
 * that carries a lock is SHARED, an unstated kind included: the pre-2026-08-27
 * refusal, verbatim. ⚠ RETIRES WITH THE LEGACY COLUMNS, IN B13.
 */
function legacyAxes(row: TokenRow): {
  containerId: string | null;
  subjectUserId: string | null;
} {
  const containerId = row.workspace_id ?? null;
  const hasPerson =
    containerId === null || row.workspace_lock_kind === CONTAINER_SESSION_LOCK;
  return { containerId, subjectUserId: hasPerson ? row.user_id : null };
}

/**
 * Read the row by token hash, tolerating a database the axis migration has not
 * reached yet.
 *
 * ⚠ THE FLAG IS STICKY AND THAT IS SAFE *BECAUSE* THE FALLBACK IS THE IDENTITY.
 * A process that starts before the migration and outlives it keeps deriving both
 * axes from the legacy pair — which {@link legacyAxes} makes indistinguishable
 * from reading the columns. The cost of the miss is one extra round trip, once.
 */
async function readTokenRow(hash: string): Promise<TokenRow | null> {
  const db = supabaseAdmin();
  const select = async (cols: string) =>
    db.from("mcp_tokens").select(cols).eq("access_token_hash", hash).maybeSingle();

  if (axisColumnsPresent) {
    const { data, error } = await select(
      `${TOKEN_COLS}, ${LEGACY_AXIS_COLS}, ${AXIS_COLS}`,
    );
    if (!error) return (data as TokenRow | null) ?? null;
    if (error.code !== UNDEFINED_COLUMN) return null;
    axisColumnsPresent = false;
  }
  const { data, error } = await select(`${TOKEN_COLS}, ${LEGACY_AXIS_COLS}`);
  if (error) return null;
  return (data as TokenRow | null) ?? null;
}

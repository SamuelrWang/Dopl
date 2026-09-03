import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { meetsMinRole, type Role } from "@/features/workspaces/types";

/**
 * 🔒 **"IS THIS ROW LENT TO A SCOPE I AM IN?" — the READ half of a grant, and
 * the one place it is answered** (F-604, 2026-09-02, wave B batch 3).
 *
 * B11 replaced the copy ops with grants: `dopl_kb(op="grant")` /
 * `dopl_agent(op="grant")` and the /home "Share into this channel" control write
 * a `resource_grants` row. B15 shipped that WRITE door and recorded that nothing
 * read it back — a lent row stayed `private` + created-by-the-grantor, so in the
 * target scope `canSeeBase`/`canSeeTemplate` refused it and the grant was a
 * recorded intent. This module is the arm both predicates were missing.
 *
 * ── 🔒 THE TWIN ────────────────────────────────────────────────────────────
 *
 * ⚠ **THIS IS ONE RULE WRITTEN TWICE AND THE HALVES MUST MOVE TOGETHER** (§5A).
 * The SQL twin is `dopl_grant_admits(text, uuid)`
 * (`20260923140000_grant_read_arm.sql`), called by
 * `dopl_knowledge_base_readable()` and `can_current_user_read_agent_template()`.
 * `scripts/check-rls-pair-gate.ts` proves each predicate still has its named
 * policy twin; the per-table redteam suites prove the two AGREE.
 *
 * ── SCOPES: TWO HERE, THE THIRD SOMEWHERE ELSE ─────────────────────────────
 *
 * `channel` and `container` only. **`team` is deliberately absent**: it is
 * already an arm of `dopl_teams_mode_visible()` / `filterTeamVisibleBases`,
 * reached through `access_mode='teams'` and `visibility='team'`, and answering
 * it here as well would be a second copy of a rule that has a home (ruling B4
 * made team a SCOPE, not a second mechanism). It is also off the MCP surface
 * entirely (A8).
 *
 * ── LEVEL IS NOT ONE LADDER, AND THIS IS WHERE THAT BITES ──────────────────
 *
 * 🔒 A `container` grant carries `read | edit` and BOTH admit reading. A
 * `channel` grant carries `agent_only | visible` — two AUDIENCES, not a high/low
 * pair (`20260827120000`) — and only `visible` names a HUMAN audience, so
 * `agent_only` must not widen a person's read. That is the same split
 * `resource_grants_member_select` makes about the grant ROW's own existence, and
 * the inverse of the one `repository-audience.ts ›
 * listGrantedBaseIdsForChannels` makes for the AGENT's ceiling, where both
 * levels count. Three lanes, one table, and each states which audience it is.
 *
 * ── WHAT THIS DOES *NOT* DO, STATED SO NOBODY INFERS IT ────────────────────
 *
 * ⚠ **IT WIDENS VISIBILITY, NEVER THE CANDIDATE SET.** `listBases` /
 * `listTemplates` read `WHERE workspace_id = ctx.workspaceId`, and
 * `resolve-resource.ts › listContainersForCaller` narrows the id lane the same
 * way. So a grant is honoured end to end when the row is ALREADY in the
 * caller's reach — a private row lent to a channel or to its own container —
 * and a row lent ACROSS containers is still not listed. Widening the fetch is a
 * TENANCY change, not a visibility one (F-662).
 */

/** The resource kinds `resource_grants.resource_type` accepts. */
export type GrantResourceType =
  | "knowledge_base"
  | "agent_template"
  | "skill"
  | "chat"
  | "chat_folder";

/** Resource ids the caller reaches through a grant. Membership is the question;
 *  the set is the answer, so the predicates stay synchronous and total. */
export type GrantedResourceIds = ReadonlySet<string>;

/** ⚠ Shared, frozen, and the value every no-grant path returns — a fresh `Set`
 *  per call would allocate on the hot list path for nothing. */
export const NO_GRANTS: GrantedResourceIds = new Set<string>();

/**
 * 🔒 **THE CEILING ON A `resource_grants` FAN-OUT, AND IT IS ONE CONSTANT.**
 * PostgREST truncates an unlimited select SILENTLY, and a truncation on either
 * lane fails in the SAFE direction (fewer rows admitted) — but invisibly, so
 * the bound is stated rather than inherited.
 *
 * ⚠ **IT WAS TWO CONSTANTS UNTIL 2026-09-02** — this one and
 * `knowledge/server/repository-audience.ts › AUDIENCE_GRANT_LIMIT`, both 500,
 * each documented as *"the same number for the same reason"* as the other.
 * Two names for one number is how they stop being the same number: whichever
 * is retuned first, the other keeps its old value and the two grant lanes
 * silently start truncating at different points. `AUDIENCE_GRANT_LIMIT` is
 * deleted and that reader imports this.
 *
 * ⚠ NOT `CHANNEL_GRANT_LIMIT` (200) OR `CONTAINER_CHANNEL_LIMIT` (200), which
 * are deliberately different numbers over different tables — a per-base grant
 * page and a container's channel list. Only the two grant FAN-OUTS share this.
 */
export const GRANT_REACH_LIMIT = 500;

/** The minimum workspace role that reads a container grant. Same floor as every
 *  other read in this system; a `guest` ranks below it by construction. */
const CONTAINER_READ_FLOOR: Role = "viewer";

interface GrantRow {
  scope_type: "channel" | "container";
  scope_id: string;
  resource_id: string;
  level: string;
}

/**
 * Which of `resourceIds` are lent to a channel or container the caller is in.
 *
 * ⚠ **A FIXED NUMBER OF QUERIES PER REQUEST — at most three, and none at all
 * when nothing is granted.** One read of the grants for this row set, then one
 * membership read per scope kind that actually occurs. The shape
 * `agent-templates/server/service-shared.ts › shareCtxForTemplates` established:
 * a batch precompute, never a query per row.
 *
 * ⚠ EMPTY `resourceIds` SHORT-CIRCUITS WITH NO QUERY. A PostgREST `.in()` on an
 * empty array is a syntax hazard, and "no rows to ask about" is a real state.
 *
 * ⚠ **NOT FILTERED BY THE CALLER'S CONTAINER, AND THAT IS THE POINT.** A grant
 * row is filed under the RESOURCE's container (`20260914120000` rule 3) while
 * the caller reaches it through the SCOPE's. A `workspace_id` term here would
 * refuse exactly the grant this function exists to honour.
 */
export async function grantedResourceIds(
  userId: string,
  resourceType: GrantResourceType,
  resourceIds: readonly string[]
): Promise<GrantedResourceIds> {
  if (resourceIds.length === 0) return NO_GRANTS;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("resource_grants")
    .select("scope_type, scope_id, resource_id, level")
    .eq("resource_type", resourceType)
    .in("resource_id", [...new Set(resourceIds)])
    .in("scope_type", ["channel", "container"])
    .limit(GRANT_REACH_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as unknown as GrantRow[];
  // 🔒 The level filter runs BEFORE the membership reads, so an `agent_only`
  // channel grant does not even cause a lookup — and cannot be widened by one.
  const admitting = rows.filter(
    (r) => r.scope_type === "container" || r.level === "visible"
  );
  if (admitting.length === 0) return NO_GRANTS;

  const scopeIds = (kind: GrantRow["scope_type"]) => [
    ...new Set(admitting.filter((r) => r.scope_type === kind).map((r) => r.scope_id)),
  ];
  const [containers, channels] = await Promise.all([
    reachableContainers(db, userId, scopeIds("container")),
    reachableChannels(db, userId, scopeIds("channel")),
  ]);

  const granted = new Set<string>();
  for (const row of admitting) {
    const reached =
      row.scope_type === "container"
        ? containers.has(row.scope_id)
        : channels.has(row.scope_id);
    if (reached) granted.add(row.resource_id);
  }
  return granted.size === 0 ? NO_GRANTS : granted;
}

/**
 * ⚠ `status='active'` AND a role floor, both. `workspaces/server/repository.ts ›
 * findMembership` carries the scar of omitting the first (a removed admin still
 * measured as one), and `guest` is exactly the rank the second keeps out.
 */
async function reachableContainers(
  db: ReturnType<typeof supabaseAdmin>,
  userId: string,
  containerIds: string[]
): Promise<Set<string>> {
  if (containerIds.length === 0) return new Set();
  const { data, error } = await db
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("workspace_id", containerIds);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    workspace_id: string;
    role: Role;
  }>;
  return new Set(
    rows
      .filter((r) => meetsMinRole(r.role, CONTAINER_READ_FLOOR))
      .map((r) => r.workspace_id)
  );
}

/** ⚠ `channel_members` has no status column and no rank — presence IS the
 *  membership, exactly as `is_channel_member()` reads it. */
async function reachableChannels(
  db: ReturnType<typeof supabaseAdmin>,
  userId: string,
  channelIds: string[]
): Promise<Set<string>> {
  if (channelIds.length === 0) return new Set();
  const { data, error } = await db
    .from("channel_members")
    .select("channel_id")
    .eq("user_id", userId)
    .in("channel_id", channelIds);
  if (error) throw error;
  return new Set(
    ((data ?? []) as unknown as Array<{ channel_id: string }>).map(
      (r) => r.channel_id
    )
  );
}

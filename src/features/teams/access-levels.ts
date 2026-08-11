/**
 * Pure helpers shared between the server access service and the client
 * teams UI. Lives outside `server/` so the client can import without
 * crossing the server-only boundary.
 *
 * Levels apply per (team, resource) grant; a member's effective level on
 * a teams-mode resource is the max across their teams, capped at their
 * role default ceiling (a viewer never exceeds read).
 */

import type { Role } from "@/features/workspaces/types";

export type AccessLevel = "read" | "edit";
export type TeamResourceType =
  | "knowledge_base"
  | "chat"
  | "chat_folder"
  | "skill";
export type AccessMode = "workspace" | "teams";

export function defaultLevelForRole(role: Role): AccessLevel {
  if (role === "owner" || role === "admin" || role === "member") return "edit";
  return "read";
}

const RANK: Record<AccessLevel, number> = { read: 0, edit: 1 };

export function meetsLevel(actual: AccessLevel, required: AccessLevel): boolean {
  return RANK[actual] >= RANK[required];
}

export function maxLevel(a: AccessLevel | null, b: AccessLevel | null): AccessLevel | null {
  if (a === null) return b;
  if (b === null) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

export function capLevel(level: AccessLevel, ceiling: AccessLevel): AccessLevel {
  return RANK[level] <= RANK[ceiling] ? level : ceiling;
}

/* ------------------------ retired resource types ------------------------ */

/**
 * THE CONTAINMENT FLOOR FOR A GRANT ROW WHOSE FEATURE NO LONGER EXISTS.
 *
 * `workflow` was hidden on 2026-08-07 (D7) and the feature was DELETED on
 * 2026-08-11 — tables, routes, types, the resource-table map, the lot. Nothing
 * in this tree can emit a `workflow` row any more, and `TeamResourceType` no
 * longer names one.
 *
 * THE SET STAYS ANYWAY, and that is the point: the rows do not come from us.
 * `team_resource_access.resource_type` still ACCEPTS `'workflow'` (the CHECK
 * constraint deliberately kept the value — see
 * `supabase/migrations/20260811120000_drop_workflows_and_clusters.sql`), so a
 * surviving or replayed row reaches a payload without passing any code we
 * deleted. This is a RENDER filter applied where a payload enters the UI; it
 * costs one string and it fails safe.
 *
 * The MCP package holds the mirror of this predicate
 * (`packages/mcp-server/src/tools/members-render.ts`); it cannot import from
 * `src/`, so the two are hand copies. One string per package, not five.
 *
 * Lives in `access-levels.ts` rather than `server/` because every consumer is
 * a client component or a `select` in a client hook.
 */
const RETIRED_RESOURCE_TYPES: ReadonlySet<string> = new Set(["workflow"]);

export function isRetiredResourceType(resourceType: string): boolean {
  return RETIRED_RESOURCE_TYPES.has(resourceType);
}

/**
 * Drop rows for retired resource types from any resource-shaped list.
 *
 * Use this for BOTH halves of a payload — the resource inventory AND every
 * team's `grants` array. Filtering only the inventory is how a team ends up
 * captioned "3 scoped resources" above a list of 2.
 */
export function withoutRetiredResources<T extends { resourceType: string }>(
  rows: readonly T[]
): T[] {
  return rows.filter((r) => !isRetiredResourceType(r.resourceType));
}

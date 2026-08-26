/**
 * Pure helpers shared by the server access service and the client teams UI.
 * Outside `server/` so the client can import without crossing server-only.
 * Levels are per (team, resource) grant; effective level on a teams-mode
 * resource = max across the user's teams, capped at their role ceiling (a
 * viewer never exceeds read).
 */

import type { Role } from "@/features/workspaces/types";

export type AccessLevel = "read" | "edit";
export type TeamResourceType =
  | "knowledge_base"
  | "chat"
  | "chat_folder"
  | "skill";
export type AccessMode = "workspace" | "teams";

/**
 * The level a ROLE carries on its own, before any team grant.
 *
 * ⚠ A `Record<Role, …>`, AND THAT IS THE WHOLE POINT OF THE REWRITE
 * (2026-08-26). This was `if (owner|admin|member) return "edit"; return "read";`
 * — an open `else` — so when `guest` was added below `viewer` it fell into the
 * VIEWER arm and silently resolved to `read`. That made this the ONE place in
 * the tree where a guest reads as a viewer, and it slipped precisely because
 * the guest-role plan's compile-time net was *"`Record<Role,number>` forces the
 * key"*, which reaches `ROLE_RANK` and nothing else. Harmless today only
 * because every knowledge / skill / chat route is `viewer`+ at the wrapper —
 * i.e. it was covered by a *different* fence, which is not the same as being
 * right.
 *
 * ⚠ `null` = NO ACCESS AT ALL, the same idiom `EffectiveAccessRow.level` and
 * `effectiveResourceAccess` already use. It is not "read with nothing to read".
 * A caller that treats the ceiling as non-null must handle it (both server
 * call sites now return `null` outright).
 *
 * ⚠ The next role added to `Role` will fail to compile HERE until somebody
 * decides what it may touch, which is the property the `if/else` gave away.
 */
const ROLE_DEFAULT_LEVEL: Record<Role, AccessLevel | null> = {
  owner: "edit",
  admin: "edit",
  member: "edit",
  viewer: "read",
  // A guest is link-granted, reaches ONE channel, and holds nothing on any
  // shareable resource (INVARIANTS §4A).
  guest: null,
};

export function defaultLevelForRole(role: Role): AccessLevel | null {
  return ROLE_DEFAULT_LEVEL[role] ?? null;
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
 * Containment floor for grant rows whose feature no longer exists.
 * ⚠ Keep this set even though nothing in this tree emits `workflow` and
 * `TeamResourceType` no longer names one: `team_resource_access.resource_type`
 * still ACCEPTS `'workflow'` (the CHECK constraint deliberately kept the
 * value, `supabase/migrations/20260811120000_drop_workflows_and_clusters.sql`),
 * so a surviving or replayed row reaches a payload without passing any deleted
 * code. This is a RENDER filter at the UI boundary and it fails safe.
 * ⚠ Hand-copied mirror in `packages/mcp-server/src/tools/members-render.ts`,
 * which cannot import from `src/` — keep both in sync.
 * Here rather than `server/` because every consumer is a client component or
 * a `select` in a client hook.
 */
const RETIRED_RESOURCE_TYPES: ReadonlySet<string> = new Set(["workflow"]);

export function isRetiredResourceType(resourceType: string): boolean {
  return RETIRED_RESOURCE_TYPES.has(resourceType);
}

/** Drop retired resource types from any resource-shaped list. ⚠ Apply to BOTH
 *  halves of a payload — the inventory AND every team's `grants` array;
 *  filtering only the inventory captions "3 scoped resources" above 2. */
export function withoutRetiredResources<T extends { resourceType: string }>(
  rows: readonly T[]
): T[] {
  return rows.filter((r) => !isRetiredResourceType(r.resourceType));
}

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

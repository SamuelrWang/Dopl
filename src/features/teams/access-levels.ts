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
 * ⚠ A `Record<Role, …>` on purpose: an open `if/else` once let `guest` fall
 * into the viewer arm and resolve to `read`. A new `Role` now fails to compile
 * HERE until someone decides what it may touch.
 *
 * ⚠ `null` = NO ACCESS AT ALL (same idiom as `EffectiveAccessRow.level`), not
 * "read with nothing to read". Callers must handle it.
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

/*
 * ⚠ No retired-type filter here: `RETIRED_RESOURCE_TYPES`, `isRetiredResourceType`
 * and `withoutRetiredResources` were deleted (2026-09-02, F-466) — `resource_grants`' CHECK
 * refuses `'workflow'`, so the failure mode it guarded cannot occur.
 */


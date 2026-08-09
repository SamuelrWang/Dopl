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
  | "workflow"
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
 * D7 (retirement, 2026-08-07) — `workflow` is no longer a resource type any
 * human-facing surface may render.
 *
 * THE ROWS DO NOT COME FROM US. The grants stay valid in the database and the
 * server keeps emitting them (D7: "Existing grant rows stay valid in the DB
 * (harmless); nothing renders them"). This is a RENDER filter, applied where a
 * payload enters the UI — so un-retiring is deleting one string, here.
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

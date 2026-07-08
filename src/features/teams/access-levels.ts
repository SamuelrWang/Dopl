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

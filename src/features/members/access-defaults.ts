/**
 * Pure helpers shared between the server access service and the client
 * matrix UI. Lives outside `server/` so the client can import without
 * crossing the server-only boundary.
 *
 * Default levels are role-derived; the override row in
 * workspace_resource_access (when present) takes precedence everywhere.
 */

import type { Role } from "@/features/workspaces/types";
import type { MemberRole } from "./types";

export type AccessLevel = "read" | "edit";
export type ResourceType = "knowledge_base" | "skill" | "canvas";

export function defaultLevelForRole(role: Role | MemberRole): AccessLevel {
  if (role === "owner" || role === "admin" || role === "member") return "edit";
  return "read";
}

const RANK: Record<AccessLevel, number> = { read: 0, edit: 1 };

export function meetsLevel(actual: AccessLevel, required: AccessLevel): boolean {
  return RANK[actual] >= RANK[required];
}

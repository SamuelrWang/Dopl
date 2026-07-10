/**
 * Member-management hierarchy rules, shared by server enforcement
 * (invitations.ts, join-links.ts) and the members UI. Pure — client-safe.
 *
 * Owners manage anyone (including themselves — last-owner protection is
 * a separate DB-backed check). Admins manage member/viewer only: never
 * themselves, never owners or other admins.
 */

import { meetsMinRole, type Role } from "./types";

export type MemberManageDenial = "not-admin" | "self" | "target-protected";

/** Why `callerRole` may not manage `targetRole`, or null when allowed. */
export function memberManageDenial(
  callerRole: Role,
  targetRole: Role,
  isSelf: boolean
): MemberManageDenial | null {
  if (!meetsMinRole(callerRole, "admin")) return "not-admin";
  if (callerRole === "owner") return null;
  if (isSelf) return "self";
  if (targetRole === "owner" || targetRole === "admin") return "target-protected";
  return null;
}

/** Only the owner can grant the admin or owner role. */
export function canGrantRole(callerRole: Role, newRole: Role): boolean {
  if (newRole === "owner" || newRole === "admin") return callerRole === "owner";
  return true;
}

/**
 * Whether the members UI renders manage controls for a row. Stricter
 * than the server rule: self and owner rows never show controls (owners
 * self-manage via ownership transfer, not the row menu).
 */
export function canShowMemberControls(
  callerRole: Role,
  targetRole: Role,
  isSelf: boolean
): boolean {
  return (
    memberManageDenial(callerRole, targetRole, isSelf) === null &&
    !isSelf &&
    targetRole !== "owner"
  );
}

/** DEVELOPER PORTAL SCOPE: who may do what in a project, and the keyset cursor. Pure: no DB, no React. */
import { isUuid } from "@/shared/lib/id/uuid";

/** A dev org role (`dev_org_members.role`; the org's `owner_user_id` reads as `owner`). */
export type PortalRole = "owner" | "admin" | "developer";

/** One project the signed-in developer can see, with the org it hangs off. */
export interface PortalProject {
  id: string;
  name: string;
  apiVersion: string;
  org: { id: string; name: string; internal: boolean };
  role: PortalRole;
}

/** One org the signed-in developer can see, even one with no project yet. */
export interface PortalOrg {
  id: string;
  name: string;
  internal: boolean;
  /** `dev_orgs.owner_user_id`: the one owner, never removable, never re-roled. */
  ownerUserId: string;
  role: PortalRole;
}

export const ROLE_RANK: Record<PortalRole, number> = { owner: 3, admin: 2, developer: 1 };

export const isPortalRole = (role: unknown): role is PortalRole => role === "owner" || role === "admin" || role === "developer";

/** Roles an invite or a role change may grant. `owner` is `dev_orgs.owner_user_id` alone. */
const ASSIGNABLE_ROLES = ["admin", "developer"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_LABEL: Record<PortalRole, string> = { owner: "Owner", admin: "Admin", developer: "Developer" };

/** Who may create, rotate and revoke keys, and create projects. A `developer` member reads only. */
export function canManageKeys(role: PortalRole): boolean {
  return role === "owner" || role === "admin";
}

/** Who may invite people and see the open invites. */
export function canManageMembers(role: PortalRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * May `actor` grant `role` (by invite or role change)? Only a role strictly BELOW their own: an
 * owner grants admin or developer, an admin grants developer. Nobody grants owner.
 */
export function canAssignRole(actor: PortalRole, role: string): role is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role) && ROLE_RANK[role as AssignableRole] < ROLE_RANK[actor];
}

/** May `actor` change or remove a member holding `target`? Only one ranked strictly below them. */
export function canActOn(actor: PortalRole, target: PortalRole): boolean {
  return ROLE_RANK[target] < ROLE_RANK[actor];
}

/**
 * A Postgres timestamptz as PostgREST returns it: up to MICROSECONDS, with `Z` or an offset.
 * ⚠ Never round-trip a cursor ts through `Date`: it truncates to milliseconds, so the `ts.eq` tie
 * branch stops matching the row's tie-mates and `ts.lt` drops older rows inside the same ms.
 */
const PG_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/** The cursor for the row a page ended on: its ts string exactly as stored, then its id. */
export function logCursor(row: { ts: string; event_id: string }): string {
  return `${row.ts}~${row.event_id}`;
}

/** A cursor split back into its parts, or null when malformed. Both parts are validated. */
export function parseLogCursor(value: string | null): { ts: string; eventId: string } | null {
  if (value === null) return null;
  const [ts, eventId, extra] = value.split("~");
  if (extra !== undefined || !ts || !PG_TS.test(ts) || Number.isNaN(Date.parse(ts))) return null;
  if (!eventId || !isUuid(eventId)) return null;
  return { ts, eventId: eventId.toLowerCase() };
}

/**
 * Only a live, never-rotated key rotates: an expired key would mint a working credential off a dead one, and a
 * key in its overlap window would get a second live replacement. Null = it may rotate.
 */
export function rotationRefusal(key: { revokedAt: string | null; expiresAt: string | null }, now: number): { code: "KEY_REVOKED" | "KEY_EXPIRED" | "KEY_ROTATING"; message: string } | null {
  if (key.revokedAt) return { code: "KEY_REVOKED", message: "A revoked key cannot be rotated" };
  if (key.expiresAt && Date.parse(key.expiresAt) <= now) return { code: "KEY_EXPIRED", message: "An expired key cannot be rotated" };
  if (key.expiresAt) return { code: "KEY_ROTATING", message: "This key is already being rotated" };
  return null;
}

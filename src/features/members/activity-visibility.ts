/**
 * Which activity rows one caller may read about another member.
 *
 * ⚠ SERVER-INVOKED. The route calls this before it answers; the client never
 * receives a row it may not show. Filtering a full feed in the renderer would
 * mean the withheld rows already reached the machine — readable in devtools, in
 * the IPC frame and in any cache that held them.
 *
 * Pure so it can be unit-tested without a database.
 */

import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";

export type ActivityVerb =
  | "member.joined"
  | "member.role_changed"
  | "member.removed"
  | "member.invited"
  | "team.created"
  | "team.member_added"
  | "team.member_removed";

/**
 * Verbs a peer never sees, whatever resource they carry.
 *
 * A removal and an invitation are ADMINISTRATION, not roster facts: the subject
 * of a removal is by definition no longer on the roster a peer can read, and an
 * invited address belongs to nobody until it is accepted. Both rows carry the
 * subject in `metadata`, so leaking them hands a peer identities the members
 * list does not show.
 */
const ADMIN_ONLY_VERBS: ReadonlySet<ActivityVerb> = new Set([
  "member.removed",
  "member.invited",
]);

/** `resourceType: null` = a workspace-level event. */
export interface ActivityEventRow {
  id: string;
  actorUserId: string;
  verb: ActivityVerb;
  resourceType: TeamResourceType | "team" | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Resources the caller reaches at any level; `read` counts as much as `edit`,
 *  the question being whether they may know it exists. */
export function reachableResourceIds(
  rows: ReadonlyArray<{ resourceId: string; level: AccessLevel | null }>
): ReadonlySet<string> {
  return new Set(rows.filter((r) => r.level !== null).map((r) => r.resourceId));
}

export interface ActivityFilterInput {
  /** Self or admin: no filtering. */
  unfiltered: boolean;
  /** From {@link reachableResourceIds} over the CALLER's own access. */
  reachable: ReadonlySet<string>;
  /** Teams the CALLER belongs to. Team events are scoped to team membership —
   *  the access matrix has no row for a team itself. */
  callerTeamIds: ReadonlySet<string>;
}

/**
 * ⚠ FAILS CLOSED. Every branch either names a reason the row is visible or
 * drops it; a shape the DB does not currently allow (a resource type with no
 * id) must not fall through to "visible" just because it is unrepresentable
 * today. This function is the boundary, not the CHECK constraint.
 */
export function filterActivity(
  rows: readonly ActivityEventRow[],
  { unfiltered, reachable, callerTeamIds }: ActivityFilterInput
): ActivityEventRow[] {
  if (unfiltered) return [...rows];
  return rows.filter((row) => {
    if (ADMIN_ONLY_VERBS.has(row.verb)) return false;
    // Workspace-level: roster facts a member can already read off the members
    // list. Both halves must be null — a half-formed row is not one of these.
    if (row.resourceType === null) return row.resourceId === null;
    if (row.resourceId === null) return false;
    if (row.resourceType === "team") return callerTeamIds.has(row.resourceId);
    return reachable.has(row.resourceId);
  });
}

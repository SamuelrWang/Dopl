/**
 * Pure shaping for the members console — no React, no fetching, so the roster's
 * grouping and ordering can be tested directly.
 */

import { ROLE_RANK } from "@/features/workspaces/types";
import type { AccessLevel } from "@/features/teams/access-levels";
import type { EffectiveAccessRow } from "@/features/teams/effective-access";
import type { TeamView } from "@/features/teams/types";
import type { WorkspaceMemberView } from "../../types";

export function displayNameOf(row: {
  displayName: string | null;
  email: string | null;
  userId: string;
}): string {
  return row.displayName || row.email || row.userId;
}

export function firstNameOf(member: WorkspaceMemberView): string {
  return displayNameOf(member).split(" ")[0];
}

/** Name + email, the two fields the roster has always matched on. */
export function matchesQuery(
  row: { displayName: string | null; email: string | null },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    (row.displayName ?? "").toLowerCase().includes(q) ||
    (row.email ?? "").toLowerCase().includes(q)
  );
}

export type SectionKey = "admins" | "members" | "viewers";

export const ROLE_SECTIONS: ReadonlyArray<{
  key: SectionKey;
  title: string;
  description: string;
}> = [
  {
    key: "admins",
    title: "Admins",
    description:
      "Admins can add and remove members and manage workspace-level settings.",
  },
  {
    key: "members",
    title: "Members",
    description: "Use everything: knowledge bases, skills, ontology.",
  },
  { key: "viewers", title: "Viewers", description: "Read-only access." },
];

function sectionOf(member: WorkspaceMemberView): SectionKey {
  if (member.role === "owner" || member.role === "admin") return "admins";
  if (member.role === "viewer") return "viewers";
  return "members";
}

/** Highest rank first, then alphabetical. */
function byRankThenName(a: WorkspaceMemberView, b: WorkspaceMemberView): number {
  return (
    ROLE_RANK[b.role] - ROLE_RANK[a.role] ||
    displayNameOf(a).localeCompare(displayNameOf(b))
  );
}

export function membersInSection(
  members: WorkspaceMemberView[],
  key: SectionKey,
  query: string
): WorkspaceMemberView[] {
  return members
    .filter((m) => sectionOf(m) === key && matchesQuery(m, query))
    .sort(byRankThenName);
}

export function teamsOf(teams: TeamView[], userId: string): TeamView[] {
  return teams.filter((t) => t.memberIds.includes(userId));
}

export interface AccessGroups {
  edit: EffectiveAccessRow[];
  read: EffectiveAccessRow[];
  none: EffectiveAccessRow[];
}

/** ⚠ `none` is empty for self by construction: the route drops those rows
 *  before they leave the server. */
export function groupAccess(rows: EffectiveAccessRow[]): AccessGroups {
  const by = (level: AccessLevel | null) => rows.filter((r) => r.level === level);
  return { edit: by("edit"), read: by("read"), none: by(null) };
}

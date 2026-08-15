/**
 * Pure effective-access computation, ⚠ SERVER-invoked only — never import
 * from client code; effective access must always resolve server-side. The
 * `/members/[userId]/access` route runs it over pre-fetched teams+resources.
 * ⚠ Encodes the same rules as the authoritative resolvers in
 * `./server/access.ts` (admins and creators edit; workspace-mode → role
 * default; teams-mode → max team grant capped at the role ceiling). They stay
 * separate because the server fns early-return to skip team queries — change
 * a rule here and change `server/access.ts` too.
 */

import type { Role } from "@/features/workspaces/types";
import {
  capLevel,
  defaultLevelForRole,
  maxLevel,
  type AccessLevel,
} from "@/features/teams/access-levels";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";

export interface EffectiveAccessRow {
  resourceType: AccessMatrixResource["resourceType"];
  resourceId: string;
  resourceName: string;
  /** null = no access (resource hidden from this member). */
  level: AccessLevel | null;
  /** Team supplying the winning level; null for role-derived access. */
  viaTeam: { teamId: string; name: string; color: string | null } | null;
}

export function computeEffectiveAccess(args: {
  memberUserId: string;
  memberRole: Role;
  teams: TeamView[];
  resources: AccessMatrixResource[];
}): EffectiveAccessRow[] {
  const { memberUserId, memberRole, teams, resources } = args;
  const isAdmin = memberRole === "owner" || memberRole === "admin";
  const ceiling = defaultLevelForRole(memberRole);
  const memberTeams = teams.filter((t) => t.memberIds.includes(memberUserId));

  return resources.map((r) => {
    if (isAdmin) {
      return { ...base(r), level: "edit" as const, viaTeam: null };
    }
    if (r.accessMode === "workspace") {
      return { ...base(r), level: ceiling, viaTeam: null };
    }
    if (r.createdBy === memberUserId) {
      return { ...base(r), level: ceiling, viaTeam: null };
    }
    let best: AccessLevel | null = null;
    let via: EffectiveAccessRow["viaTeam"] = null;
    for (const team of memberTeams) {
      const grant = team.grants.find(
        (g) => g.resourceType === r.resourceType && g.resourceId === r.resourceId
      );
      if (!grant) continue;
      const next = maxLevel(best, grant.level);
      if (next !== best) {
        best = next;
        via = { teamId: team.id, name: team.name, color: team.color };
      }
    }
    return {
      ...base(r),
      level: best === null ? null : capLevel(best, ceiling),
      viaTeam: best === null ? null : via,
    };
  });
}

function base(r: AccessMatrixResource) {
  return {
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    resourceName: r.name,
  };
}

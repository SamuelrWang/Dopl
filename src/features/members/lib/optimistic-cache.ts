import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";
import type {
  AccessMatrixResource,
  AccessMode,
  TeamView,
} from "@/features/teams/types";
import type {
  AssignableRole,
  JoinRequestView,
  WorkspaceInvitationView,
  WorkspaceMemberView,
} from "../types";

/**
 * Pure half of the members console's optimistic layer: how each cache
 * absorbs one membership / team / access change. No React, no DOM, no net.
 *
 * ⚠ CACHE SHAPES ARE THE RAW RESPONSE BODIES. `useApiQuery` stores what the
 * endpoint returned and applies `select` on read, so patch
 * `{ members: [...] }` / `{ teams: [...] }`, never the selected array —
 * selectors filter (`useInvitations` drops accepted, `useWorkspaceResources`
 * drops retired types), so writing the SELECTED shape back would delete the
 * rows the selector hid.
 *
 * ⚠ AN UNDEFINED CACHE STAYS UNDEFINED, everywhere. Seeding a never-loaded
 * query renders a one-row list that flips to the full list on read. The
 * mutation layer declines to cancel such a query for the same reason.
 */

export interface MembersCache {
  members: WorkspaceMemberView[];
}
export interface InvitationsCache {
  invitations: WorkspaceInvitationView[];
}
export interface TeamsCache {
  teams: TeamView[];
}
export interface ResourcesCache {
  resources: AccessMatrixResource[];
}
export interface JoinRequestsCache {
  requests: JoinRequestView[];
}
export interface JoinLinkCache {
  token: string;
}

// ── Roster ──────────────────────────────────────────────────────────

/** Role chip and role SELECT read the same roster row. */
export function setMemberRole(
  cache: MembersCache | undefined,
  userId: string,
  role: AssignableRole
): MembersCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    members: cache.members.map((m) =>
      m.userId === userId ? { ...m, role } : m
    ),
  };
}

export function dropMember(
  cache: MembersCache | undefined,
  userId: string
): MembersCache | undefined {
  if (!cache) return cache;
  return { ...cache, members: cache.members.filter((m) => m.userId !== userId) };
}

/** Add / remove a team chip on a roster row (the `teams` preview refs). */
export function setMemberTeamRef(
  cache: MembersCache | undefined,
  userIds: string[],
  team: TeamView,
  present: boolean
): MembersCache | undefined {
  if (!cache) return cache;
  const targets = new Set(userIds);
  return {
    ...cache,
    members: cache.members.map((m) => {
      if (!targets.has(m.userId)) return m;
      const without = m.teams.filter((t) => t.teamId !== team.id);
      return {
        ...m,
        teams: present
          ? [
              ...without,
              {
                teamId: team.id,
                name: team.name,
                color: team.color,
                icon: team.icon,
              },
            ]
          : without,
      };
    }),
  };
}

/** A deleted team's chips leave every roster row at once. */
export function dropTeamRef(
  cache: MembersCache | undefined,
  teamId: string
): MembersCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    members: cache.members.map((m) =>
      m.teams.some((t) => t.teamId === teamId)
        ? { ...m, teams: m.teams.filter((t) => t.teamId !== teamId) }
        : m
    ),
  };
}

// ── Invitations & join requests ─────────────────────────────────────

/** Revoke is a hard delete server-side, so dropping the row IS the revoked
 *  state; snapshot restore puts it back if the DELETE fails. */
export function dropInvitation(
  cache: InvitationsCache | undefined,
  invitationId: string
): InvitationsCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    invitations: cache.invitations.filter((i) => i.id !== invitationId),
  };
}

/** Queue holds only pending rows, so dropping IS the decided state — and it
 *  makes approve/decline un-double-fireable (buttons gone next frame). */
export function dropJoinRequest(
  cache: JoinRequestsCache | undefined,
  requestId: string
): JoinRequestsCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    requests: cache.requests.filter((r) => r.id !== requestId),
  };
}

// ── Teams ───────────────────────────────────────────────────────────

/** Crumb, list row and header all read this row. */
export function patchTeam(
  cache: TeamsCache | undefined,
  teamId: string,
  patch: Partial<TeamView>
): TeamsCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    teams: cache.teams.map((t) => (t.id === teamId ? { ...t, ...patch } : t)),
  };
}

export function dropTeam(
  cache: TeamsCache | undefined,
  teamId: string
): TeamsCache | undefined {
  if (!cache) return cache;
  return { ...cache, teams: cache.teams.filter((t) => t.id !== teamId) };
}

/** ⚠ Patch `memberCount` with `memberIds` — the list caption reads the count,
 *  the detail pane reads the ids; one without the other shows "3 members"
 *  above a list of 2. */
export function setTeamMembers(
  cache: TeamsCache | undefined,
  teamId: string,
  userIds: string[],
  present: boolean
): TeamsCache | undefined {
  if (!cache) return cache;
  const changed = new Set(userIds);
  return {
    ...cache,
    teams: cache.teams.map((t) => {
      if (t.id !== teamId) return t;
      const without = t.memberIds.filter((id) => !changed.has(id));
      const memberIds = present ? [...without, ...userIds] : without;
      return { ...t, memberIds, memberCount: memberIds.length };
    }),
  };
}

/** Drop a removed workspace member from every team they were in. */
export function dropMemberFromTeams(
  cache: TeamsCache | undefined,
  userId: string
): TeamsCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    teams: cache.teams.map((t) => {
      if (!t.memberIds.includes(userId)) return t;
      const memberIds = t.memberIds.filter((id) => id !== userId);
      return { ...t, memberIds, memberCount: memberIds.length };
    }),
  };
}

/** Set (or clear, `level: null`) one team's grant on one resource. Grants
 *  live on the TEAM row, not the resource row, so this one patch moves the
 *  team detail's grant boxes, the resource detail's per-team list, and the
 *  Access tab's "N team grants" caption. */
export function setTeamGrant(
  cache: TeamsCache | undefined,
  teamId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  level: AccessLevel | null
): TeamsCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    teams: cache.teams.map((t) => {
      if (t.id !== teamId) return t;
      const others = t.grants.filter(
        (g) => !(g.resourceType === resourceType && g.resourceId === resourceId)
      );
      return {
        ...t,
        grants:
          level === null
            ? others
            : [...others, { teamId, resourceType, resourceId, level }],
      };
    }),
  };
}

// ── Access matrix ───────────────────────────────────────────────────

/** Flip a resource between workspace-wide and teams-scoped. The segmented
 *  control renders straight off `accessMode`. */
export function setResourceMode(
  cache: ResourcesCache | undefined,
  resourceType: TeamResourceType,
  resourceId: string,
  accessMode: AccessMode
): ResourcesCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    resources: cache.resources.map((r) =>
      r.resourceType === resourceType && r.resourceId === resourceId
        ? { ...r, accessMode }
        : r
    ),
  };
}

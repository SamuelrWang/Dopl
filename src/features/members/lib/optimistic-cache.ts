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
 * The pure half of the members console's optimistic layer: how each cache
 * absorbs one membership / team / access change.
 *
 * Split from the hooks so every rule here is testable with no React, no DOM and
 * no network — which matters because these are the rules that decide whether a
 * revoked invitation actually leaves the screen, and whether a rolled-back
 * failure puts it back where it was.
 *
 * THE CACHE SHAPES ARE THE RAW RESPONSE BODIES. `useApiQuery` stores what the
 * endpoint returned and applies `select` on read, so a patch operates on
 * `{ members: [...] }` / `{ teams: [...] }`, never on the selected array —
 * including where the selector filters (`useInvitations` drops accepted rows,
 * `useWorkspaceResources` drops retired types). A patch that wrote the SELECTED
 * shape back would delete the rows the selector had hidden.
 *
 * AN UNDEFINED CACHE STAYS UNDEFINED, everywhere. Seeding a query that has
 * never loaded would render a one-row list and then flip to the full list when
 * the read lands; the mutation layer also declines to cancel such a query for
 * exactly this reason.
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

/**
 * The role chip and the role SELECT read the same roster row, so patching it
 * is what stops the control showing the old value for the length of the round
 * trip (the "stale-value toggle" class in the launch audit).
 */
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

/**
 * A revoked invitation is a hard delete server-side, so dropping the row IS
 * the revoked state — and the layer's snapshot restore is what puts it back if
 * the DELETE fails.
 */
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

/**
 * A resolved join request leaves the queue at once, approve or decline. The
 * queue only ever holds pending rows, so dropping it is the decided state —
 * and it is also what makes the approve/decline pair un-double-fireable: the
 * row (and its two buttons) is gone one frame after the click, not one round
 * trip after it.
 */
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

/** Patch one team row — the crumb, the list row and the header read it. */
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

/**
 * Team membership, with `memberCount` kept in step — the list row's
 * "N members" caption and the detail pane's "Members · N" label are computed
 * from two different fields of the same row, and patching one without the
 * other is how a team reads "3 members" above a list of 2.
 */
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

/**
 * Set (or clear, with `level: null`) one team's grant on one resource.
 *
 * Grants live on the TEAM row, not on the resource row, so this single patch is
 * what moves both surfaces that render the level: the team detail's grant boxes
 * and the resource detail's per-team list. The Access tab's "N team grants"
 * caption is derived from the same array, so it follows without a second patch.
 */
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

/**
 * Flip a resource between workspace-wide and teams-scoped. The segmented
 * control is driven straight off `accessMode`, so this patch is the thumb
 * moving on the click rather than after the round trip.
 */
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

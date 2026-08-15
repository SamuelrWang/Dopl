/** Members console cache rules — no React, DOM or network. Each is reached by
 *  a mutation config in `hooks/use-*-writes.ts`; proving them here is what
 *  lets those configs stay declarative. */

import { describe, expect, it } from "vitest";
import type { TeamView } from "@/features/teams/types";
import type { WorkspaceInvitationView, WorkspaceMemberView } from "../types";
import {
  dropInvitation,
  dropJoinRequest,
  dropMember,
  dropMemberFromTeams,
  dropTeam,
  dropTeamRef,
  patchTeam,
  setMemberRole,
  setMemberTeamRef,
  setResourceMode,
  setTeamGrant,
  setTeamMembers,
  type InvitationsCache,
  type JoinRequestsCache,
  type MembersCache,
  type ResourcesCache,
  type TeamsCache,
} from "./optimistic-cache";

function member(over: Partial<WorkspaceMemberView> = {}): WorkspaceMemberView {
  return {
    workspaceId: "w-1",
    userId: "u-1",
    role: "member",
    status: "active",
    joinedAt: "2026-08-01T00:00:00.000Z",
    invitedBy: null,
    invitedAt: null,
    lastSeenAt: null,
    email: "ada@example.com",
    displayName: "Ada",
    avatarUrl: null,
    teams: [],
    ...over,
  };
}

function team(over: Partial<TeamView> = {}): TeamView {
  return {
    id: "t-1",
    workspaceId: "w-1",
    name: "Growth",
    description: null,
    color: "#8b5cf6",
    icon: null,
    createdBy: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    memberCount: 0,
    memberIds: [],
    grants: [],
    ...over,
  };
}

function invitation(
  over: Partial<WorkspaceInvitationView> = {}
): WorkspaceInvitationView {
  return {
    id: "i-1",
    workspaceId: "w-1",
    email: "new@example.com",
    invitedRole: "member",
    invitedBy: "u-1",
    token: "tok",
    expiresAt: "2026-09-01T00:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

describe("an unloaded cache is never seeded", () => {
  // ⚠ Writing a one-row list into a never-answered query renders that row and
  // then flips to the full list.
  it("returns undefined from every patch", () => {
    expect(setMemberRole(undefined, "u-1", "admin")).toBeUndefined();
    expect(dropMember(undefined, "u-1")).toBeUndefined();
    expect(dropInvitation(undefined, "i-1")).toBeUndefined();
    expect(dropJoinRequest(undefined, "j-1")).toBeUndefined();
    expect(patchTeam(undefined, "t-1", { name: "x" })).toBeUndefined();
    expect(dropTeam(undefined, "t-1")).toBeUndefined();
    expect(setTeamMembers(undefined, "t-1", ["u-1"], true)).toBeUndefined();
    expect(dropMemberFromTeams(undefined, "u-1")).toBeUndefined();
    expect(setTeamGrant(undefined, "t-1", "skill", "s-1", "read")).toBeUndefined();
    expect(setResourceMode(undefined, "skill", "s-1", "teams")).toBeUndefined();
    expect(setMemberTeamRef(undefined, ["u-1"], team(), true)).toBeUndefined();
    expect(dropTeamRef(undefined, "t-1")).toBeUndefined();
  });
});

describe("roster patches", () => {
  const cache: MembersCache = {
    members: [member(), member({ userId: "u-2", role: "viewer" })],
  };

  it("moves only the targeted member's role, and leaves the rest identical", () => {
    const next = setMemberRole(cache, "u-2", "admin");
    expect(next?.members.map((m) => m.role)).toEqual(["member", "admin"]);
    // Untouched rows keep identity, so nothing else re-renders.
    expect(next?.members[0]).toBe(cache.members[0]);
    // ⚠ Input not mutated — the layer's rollback depends on it.
    expect(cache.members[1].role).toBe("viewer");
  });

  it("drops a removed member", () => {
    expect(dropMember(cache, "u-1")?.members.map((m) => m.userId)).toEqual([
      "u-2",
    ]);
  });

  it("adds and removes a team chip without duplicating it", () => {
    const t = team();
    const once = setMemberTeamRef(cache, ["u-1"], t, true);
    const twice = setMemberTeamRef(once, ["u-1"], t, true);
    expect(twice?.members[0].teams).toEqual([
      { teamId: "t-1", name: "Growth", color: "#8b5cf6", icon: null },
    ]);
    expect(setMemberTeamRef(twice, ["u-1"], t, false)?.members[0].teams).toEqual(
      []
    );
  });

  it("clears a deleted team's chip from every row it was on", () => {
    const withChips = setMemberTeamRef(cache, ["u-1", "u-2"], team(), true);
    const next = dropTeamRef(withChips, "t-1");
    expect(next?.members.every((m) => m.teams.length === 0)).toBe(true);
  });
});

describe("invitation + join-request queues", () => {
  it("drops the revoked invitation and only that one", () => {
    const cache: InvitationsCache = {
      invitations: [invitation(), invitation({ id: "i-2" })],
    };
    expect(dropInvitation(cache, "i-1")?.invitations.map((i) => i.id)).toEqual([
      "i-2",
    ]);
  });

  it("drops the resolved join request — the same drop for approve and decline", () => {
    const cache: JoinRequestsCache = {
      requests: [
        {
          id: "j-1",
          userId: "u-9",
          requestedAt: "2026-08-01T00:00:00.000Z",
          email: null,
          displayName: null,
          avatarUrl: null,
        },
      ],
    };
    expect(dropJoinRequest(cache, "j-1")?.requests).toEqual([]);
    // Deciding an already-gone row is a no-op, not a throw: the queue may
    // refetch between click and settle.
    expect(dropJoinRequest(cache, "nope")?.requests).toHaveLength(1);
  });
});

describe("team patches", () => {
  it("renames without touching anything else on the row", () => {
    const cache: TeamsCache = { teams: [team({ description: "keep me" })] };
    const next = patchTeam(cache, "t-1", { name: "Growth EU" });
    expect(next?.teams[0].name).toBe("Growth EU");
    expect(next?.teams[0].description).toBe("keep me");
  });

  it("drops a deleted team", () => {
    const cache: TeamsCache = { teams: [team(), team({ id: "t-2" })] };
    expect(dropTeam(cache, "t-1")?.teams.map((t) => t.id)).toEqual(["t-2"]);
  });

  it("keeps memberCount in step with memberIds, both ways", () => {
    const cache: TeamsCache = { teams: [team()] };
    const added = setTeamMembers(cache, "t-1", ["u-1", "u-2"], true);
    expect(added?.teams[0].memberIds).toEqual(["u-1", "u-2"]);
    expect(added?.teams[0].memberCount).toBe(2);

    const removed = setTeamMembers(added, "t-1", ["u-1"], false);
    expect(removed?.teams[0].memberIds).toEqual(["u-2"]);
    expect(removed?.teams[0].memberCount).toBe(1);
  });

  it("never double-adds a member who is already in the team", () => {
    const cache: TeamsCache = { teams: [team({ memberIds: ["u-1"], memberCount: 1 })] };
    const next = setTeamMembers(cache, "t-1", ["u-1"], true);
    expect(next?.teams[0].memberIds).toEqual(["u-1"]);
    expect(next?.teams[0].memberCount).toBe(1);
  });

  it("removes a departing workspace member from every team at once", () => {
    const cache: TeamsCache = {
      teams: [
        team({ memberIds: ["u-1", "u-2"], memberCount: 2 }),
        team({ id: "t-2", memberIds: ["u-1"], memberCount: 1 }),
        team({ id: "t-3", memberIds: ["u-2"], memberCount: 1 }),
      ],
    };
    const next = dropMemberFromTeams(cache, "u-1");
    expect(next?.teams.map((t) => t.memberCount)).toEqual([1, 0, 1]);
    // Team that never had them is the same object — no wasted render.
    expect(next?.teams[2]).toBe(cache.teams[2]);
  });
});

describe("grants and scope", () => {
  it("replaces a level in place rather than stacking a second grant", () => {
    const cache: TeamsCache = {
      teams: [
        team({
          grants: [
            { teamId: "t-1", resourceType: "skill", resourceId: "s-1", level: "read" },
          ],
        }),
      ],
    };
    const next = setTeamGrant(cache, "t-1", "skill", "s-1", "edit");
    expect(next?.teams[0].grants).toEqual([
      { teamId: "t-1", resourceType: "skill", resourceId: "s-1", level: "edit" },
    ]);
  });

  it("removes the grant row entirely on level null", () => {
    const cache: TeamsCache = {
      teams: [
        team({
          grants: [
            { teamId: "t-1", resourceType: "skill", resourceId: "s-1", level: "read" },
            {
              teamId: "t-1",
              resourceType: "knowledge_base",
              resourceId: "k-1",
              level: "edit",
            },
          ],
        }),
      ],
    };
    const next = setTeamGrant(cache, "t-1", "skill", "s-1", null);
    expect(next?.teams[0].grants.map((g) => g.resourceId)).toEqual(["k-1"]);
  });

  it("does not confuse two resources that share an id across types", () => {
    const cache: TeamsCache = {
      teams: [
        team({
          grants: [
            { teamId: "t-1", resourceType: "skill", resourceId: "x", level: "read" },
            {
              teamId: "t-1",
              resourceType: "knowledge_base",
              resourceId: "x",
              level: "read",
            },
          ],
        }),
      ],
    };
    const next = setTeamGrant(cache, "t-1", "skill", "x", "edit");
    expect(next?.teams[0].grants).toContainEqual({
      teamId: "t-1",
      resourceType: "knowledge_base",
      resourceId: "x",
      level: "read",
    });
  });

  it("flips one resource's scope and no other", () => {
    const cache: ResourcesCache = {
      resources: [
        {
          resourceType: "skill",
          resourceId: "s-1",
          name: "Skill",
          accessMode: "workspace",
          createdBy: null,
        },
        {
          resourceType: "knowledge_base",
          resourceId: "k-1",
          name: "KB",
          accessMode: "workspace",
          createdBy: null,
        },
      ],
    };
    const next = setResourceMode(cache, "skill", "s-1", "teams");
    expect(next?.resources.map((r) => r.accessMode)).toEqual([
      "teams",
      "workspace",
    ]);
  });
});

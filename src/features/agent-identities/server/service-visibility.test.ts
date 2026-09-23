/**
 * The visibility matrix as a whole grid: `canSeeIdentity` is ordered arms, and an arm-order bug looks
 * right on any single hand-written case.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { meetsMinRole } from "@/features/workspaces/types";

vi.mock("@/shared/tenancy/resource-grant-reach", async (orig) =>
  (await import("./service-writes-fixtures")).noGrantsMock(orig)
);
vi.mock("./repository", async () => (await import("./service-writes-fixtures")).repoMock());

import * as repo from "./repository";
import { getIdentityById, listIdentities } from "./service";
import { AgentIdentityNotFoundError } from "./errors";
import { OWNER as CREATOR, ctx, identity, resetReadMocks } from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);

const TEAMMATE = "user-teammate";
const OUTSIDER = "user-outsider";
const ADMIN = "user-admin";
const SHARED_TEAM = "team-shared";

beforeEach(() => {
  vi.clearAllMocks();
  resetReadMocks(mockRepo);
});

/** The callers the matrix distinguishes; `teamsOf` is what `listTeamIdsForUser` answers for each. */
const CALLERS = {
  creator: { c: ctx({ userId: CREATOR }), teamsOf: [] as string[] },
  teammate: { c: ctx({ userId: TEAMMATE }), teamsOf: [SHARED_TEAM] },
  nonTeamMember: { c: ctx({ userId: OUTSIDER }), teamsOf: ["team-other"] },
  admin: { c: ctx({ userId: ADMIN, role: "admin" }), teamsOf: [] as string[] },
  // A workspace-scoped API key: shareable between humans, so it inherits no one's reach.
  workspaceKey: {
    c: ctx({ userId: CREATOR, apiKeyWorkspaceId: "ws-1", credentialSubjectUserId: null }),
    teamsOf: [] as string[],
  },
  // A container-session child credential: same lock as `workspaceKey`, but one human's session (F-333).
  containerSession: {
    c: ctx({
      userId: CREATOR,
      apiKeyWorkspaceId: "ws-1",
      credentialSubjectUserId: CREATOR,
    }),
    teamsOf: [] as string[],
  },
  // The peer's session proves the widening is per person, not per credential kind.
  containerSessionPeer: {
    c: ctx({
      userId: OUTSIDER,
      apiKeyWorkspaceId: "ws-1",
      credentialSubjectUserId: OUTSIDER,
    }),
    teamsOf: [] as string[],
  },
} as const;

type CallerName = keyof typeof CALLERS;

/** Written out, not computed: a grid derived from the implementation's rules would pass a wrong one. */
const EXPECTED: Record<
  "private" | "team" | "workspace",
  Record<CallerName, boolean>
> = {
  private: {
    creator: true,
    teammate: false,
    nonTeamMember: false,
    // An admin administers sharing, which is not a read of a private row.
    admin: false,
    // The key IS the creator by user id and still gets nothing; the credential kind decides.
    workspaceKey: false,
    containerSession: true,
    containerSessionPeer: false,
  },
  team: {
    creator: true,
    teammate: true,
    nonTeamMember: false,
    admin: true,
    workspaceKey: false,
    containerSession: true,
    containerSessionPeer: false,
  },
  workspace: {
    creator: true,
    teammate: true,
    nonTeamMember: true,
    admin: true,
    workspaceKey: true,
    containerSession: true,
    containerSessionPeer: true,
  },
};

describe("canSeeIdentity — 3 visibilities × 7 callers, every cell", () => {
  for (const visibility of ["private", "team", "workspace"] as const) {
    for (const callerName of Object.keys(CALLERS) as CallerName[]) {
      const expected = EXPECTED[visibility][callerName];
      it(`${visibility} identity is ${expected ? "VISIBLE" : "hidden"} to ${callerName}`, async () => {
        const row = identity({ visibility });
        const caller = CALLERS[callerName];
        mockRepo.listIdentitiesForWorkspace.mockResolvedValue([row]);
        mockRepo.listTeamLinksForIdentities.mockResolvedValue(
          visibility === "team"
            ? [{ identityId: row.id, teamId: SHARED_TEAM }]
            : []
        );
        mockRepo.listTeamIdsForUser.mockResolvedValue([...caller.teamsOf]);

        const listed = await listIdentities(caller.c);
        expect(listed.map((t) => t.id)).toEqual(expected ? [row.id] : []);

        // The list filter and the single-row gate are separate paths and must agree.
        mockRepo.findIdentityById.mockResolvedValue(row);
        const single = getIdentityById(caller.c, row.id);
        if (expected) {
          await expect(single).resolves.toMatchObject({ id: row.id });
        } else {
          await expect(single).rejects.toBeInstanceOf(AgentIdentityNotFoundError);
        }
      });
    }
  }
});

/** No identity route lowers the `viewer` floor (the route tests pin it), and a guest ranks below it (F-333). */
describe("the guest floor — why the container-session arm has no guest arm", () => {
  it("guest does not clear the viewer floor every identity route sits at", () => {
    expect(meetsMinRole("guest", "viewer")).toBe(false);
    expect(meetsMinRole("viewer", "viewer")).toBe(true);
  });
});

describe("cross-workspace isolation", () => {
  it("every read is workspace-filtered AT THE REPOSITORY, not by the caller", async () => {
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue([]);
    await listIdentities(ctx({ workspaceId: "ws-other" }));
    // The second argument is the shelf; `undefined` means no shelf filter, a different axis from the fence.
    expect(mockRepo.listIdentitiesForWorkspace).toHaveBeenCalledWith(
      "ws-other",
      undefined
    );
  });

  it("a missing row 404s exactly like an invisible one", async () => {
    mockRepo.findIdentityById.mockResolvedValue(null);
    await expect(getIdentityById(ctx(), "id-gone")).rejects.toBeInstanceOf(
      AgentIdentityNotFoundError
    );
  });
});

describe("the sharing set is owner/admin-only", () => {
  const row = identity({ visibility: "team" });

  beforeEach(() => {
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue([row]);
    mockRepo.listTeamLinksForIdentities.mockResolvedValue([
      { identityId: row.id, teamId: SHARED_TEAM },
      { identityId: row.id, teamId: "team-second" },
    ]);
  });

  it("the creator sees which teams it is shared with", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([]);
    const [t] = await listIdentities(ctx({ userId: CREATOR }));
    expect(t.teamIds.sort()).toEqual(["team-second", SHARED_TEAM].sort());
  });

  it("a workspace admin sees it (they administer sharing)", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([]);
    const [t] = await listIdentities(ctx({ userId: ADMIN, role: "admin" }));
    expect(t.teamIds).toHaveLength(2);
  });

  it("a granted TEAMMATE sees the identity and NOT the team list", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([SHARED_TEAM]);
    const [t] = await listIdentities(ctx({ userId: TEAMMATE }));
    // Which other teams have it is org-chart information.
    expect(t.id).toBe(row.id);
    expect(t.teamIds).toEqual([]);
  });

  it("a workspace-visible identity reports no teams even to its creator", async () => {
    const open = identity({ visibility: "workspace" });
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue([open]);
    mockRepo.listTeamLinksForIdentities.mockResolvedValue([]);
    const [t] = await listIdentities(ctx({ userId: CREATOR }));
    // Stale links from a previous `team` scope must not read as live sharing.
    expect(t.teamIds).toEqual([]);
  });
});

describe("fixed query count", () => {
  it("no team lookup at all when nothing is team-scoped", async () => {
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue([
      identity({ id: "a", visibility: "private" }),
      identity({ id: "b", visibility: "workspace" }),
    ]);
    await listIdentities(ctx({ userId: OUTSIDER }));
    expect(mockRepo.listTeamLinksForIdentities).not.toHaveBeenCalled();
    expect(mockRepo.listTeamIdsForUser).not.toHaveBeenCalled();
  });

  it("ONE team-link query for many team-scoped rows, not one per row", async () => {
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue([
      identity({ id: "a", visibility: "team", createdBy: OUTSIDER }),
      identity({ id: "b", visibility: "team", createdBy: OUTSIDER }),
      identity({ id: "c", visibility: "team", createdBy: OUTSIDER }),
    ]);
    await listIdentities(ctx({ userId: TEAMMATE }));
    expect(mockRepo.listTeamLinksForIdentities).toHaveBeenCalledTimes(1);
    expect(mockRepo.listTeamLinksForIdentities).toHaveBeenCalledWith("ws-1", [
      "a",
      "b",
      "c",
    ]);
    expect(mockRepo.listTeamIdsForUser).toHaveBeenCalledTimes(1);
  });
});

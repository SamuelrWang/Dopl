/**
 * Write invariants. The KB attach fence is the security-critical block: without it an identity launders
 * a private base to every member's agent. Each arm of the mirrored `canSeeBase` is pinned because the
 * copy will not notice when the original moves.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/tenancy/resource-grant-reach", async (orig) =>
  (await import("./service-writes-fixtures")).noGrantsMock(orig)
);
// Update/delete follow the id on a miss; "nameable nowhere else" keeps the 404-never-403 cases honest.
vi.mock("@/shared/tenancy/resolve-resource", async (orig) =>
  (await import("./service-writes-fixtures")).resolveNowhereMock(orig)
);
vi.mock("@/features/workspaces/server/repository", async () =>
  (await import("./service-writes-fixtures")).workspaceRepoMock()
);
vi.mock("@/features/workspaces/server/repository-overview", () => ({
  countActiveMembers: vi.fn().mockResolvedValue(1),
}));
vi.mock("./repository", async () => (await import("./service-writes-fixtures")).repoMock());

import * as repo from "./repository";
import { createIdentity, deleteIdentity, updateIdentity } from "./service";
import {
  IdentityKnowledgeBaseNotFoundError,
  IdentityTeamNotGrantableError,
  IdentityTeamScopeAgentForbiddenError,
  IdentityWriteForbiddenError,
  WorkspaceKeyPrivateIdentityError,
} from "./errors";

import {
  BASES,
  KB_OPEN,
  KB_PRIVATE,
  KB_TEAM,
  OTHER,
  OWNER,
  TEAM_A,
  TEAM_B,
  ctx,
  resetRepoMocks,
  identity,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);

beforeEach(() => {
  vi.clearAllMocks();
  resetRepoMocks(mockRepo);
});

describe("createIdentity — visibility defaults by caller kind", () => {
  it("a session caller gets 'private' by default", async () => {
    await createIdentity(ctx(), { name: "Researcher" });
    expect(mockRepo.insertIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "private", createdBy: OWNER })
    );
  });

  it("a workspace-scoped API key gets 'workspace' and CANNOT ask for private", async () => {
    const keyCtx = ctx({ apiKeyWorkspaceId: "ws-1", credentialSubjectUserId: null });
    await createIdentity(keyCtx, { name: "Researcher" });
    expect(mockRepo.insertIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "workspace" })
    );
    await expect(
      createIdentity(keyCtx, { name: "X", visibility: "private" })
    ).rejects.toBeInstanceOf(WorkspaceKeyPrivateIdentityError);
  });

  // The create fence's update twin: POST `workspace` then PATCH `private` must not work (F-289).
  it("…and it cannot reach 'private' by PATCHing afterwards either", async () => {
    const keyCtx = ctx({ apiKeyWorkspaceId: "ws-1", credentialSubjectUserId: null });
    const owned = identity({ visibility: "workspace", createdBy: OWNER });
    mockRepo.findIdentityById.mockResolvedValue(owned);
    await expect(
      updateIdentity(keyCtx, "id-1", { visibility: "private" })
    ).rejects.toBeInstanceOf(WorkspaceKeyPrivateIdentityError);
    expect(mockRepo.updateIdentityRow).not.toHaveBeenCalled();
  });

  // A workspace key cannot read a private row (arm 2), so this is the 404, before the fence.
  it("a workspace key cannot even SEE an already-private identity to PATCH it", async () => {
    const keyCtx = ctx({ apiKeyWorkspaceId: "ws-1", credentialSubjectUserId: null });
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "private", createdBy: OWNER })
    );
    await expect(updateIdentity(keyCtx, "id-1", { name: "Renamed" })).rejects.toThrow();
    expect(mockRepo.updateIdentityRow).not.toHaveBeenCalled();
  });

  it("a workspace key may still PATCH a workspace identity", async () => {
    const keyCtx = ctx({ apiKeyWorkspaceId: "ws-1", credentialSubjectUserId: null });
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "workspace", createdBy: OWNER })
    );
    await updateIdentity(keyCtx, "id-1", { name: "Renamed" });
    expect(mockRepo.updateIdentityRow).toHaveBeenCalled();
  });

  it("a session caller may still make an identity private", async () => {
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "workspace", createdBy: OWNER })
    );
    await updateIdentity(ctx(), "id-1", { visibility: "private" });
    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      expect.objectContaining({ visibility: "private" })
    );
  });

  it("empty prose is stored as NULL, not as an empty string", async () => {
    await createIdentity(ctx(), {
      name: "Researcher",
      description: "   ",
      instructions: "",
    });
    expect(mockRepo.insertIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ description: null, instructions: null })
    );
  });
});

describe("KB attach validation — a base you cannot read, you cannot attach", () => {
  it("attaches a workspace-visible base", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);
    await createIdentity(ctx(), {
      name: "R",
      knowledgeBaseIds: [KB_OPEN],
    });
    // `knowledgeBaseIds` still means whole bases, translated to scopes at one seam.
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      [{ baseId: KB_OPEN, scope: "base" }],
      OWNER
    );
  });

  it("REFUSES someone else's private base — and 404s rather than 403s", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_PRIVATE]]);
    const err = await createIdentity(ctx(), {
      name: "R",
      knowledgeBaseIds: [KB_PRIVATE],
    }).catch((e) => e);
    // A distinguishable "forbidden" would be an existence oracle for private bases.
    expect(err).toBeInstanceOf(IdentityKnowledgeBaseNotFoundError);
    expect(err.missingIds).toEqual([KB_PRIVATE]);
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
  });

  it("allows the OWNER of a private base to attach their own", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      { ...BASES[KB_PRIVATE], createdBy: OWNER },
    ]);
    await expect(
      createIdentity(ctx(), { name: "R", knowledgeBaseIds: [KB_PRIVATE] })
    ).resolves.toBeTruthy();
  });

  it("REFUSES a teams-mode base the caller has no team on", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_TEAM]]);
    mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([
      { knowledgeBaseId: KB_TEAM, teamId: TEAM_A },
    ]);
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_B]);
    await expect(
      createIdentity(ctx(), { name: "R", knowledgeBaseIds: [KB_TEAM] })
    ).rejects.toBeInstanceOf(IdentityKnowledgeBaseNotFoundError);
  });

  it("ALLOWS a teams-mode base the caller shares a team with", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_TEAM]]);
    mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([
      { knowledgeBaseId: KB_TEAM, teamId: TEAM_A },
    ]);
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      createIdentity(ctx(), { name: "R", knowledgeBaseIds: [KB_TEAM] })
    ).resolves.toBeTruthy();
  });

  it("REFUSES an id that does not resolve at all (deleted, or another workspace)", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
    await expect(
      createIdentity(ctx(), { name: "R", knowledgeBaseIds: [KB_OPEN] })
    ).rejects.toBeInstanceOf(IdentityKnowledgeBaseNotFoundError);
  });

  it("VALIDATES BEFORE INSERTING — a rejected attach leaves no identity behind", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_PRIVATE]]);
    await createIdentity(ctx(), {
      name: "R",
      knowledgeBaseIds: [KB_PRIVATE],
    }).catch(() => undefined);
    // No transaction spans insert + two junction writes, so order is the atomicity.
    expect(mockRepo.insertIdentity).not.toHaveBeenCalled();
  });

  it("the same fence applies on UPDATE, not only on create", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_PRIVATE]]);
    await expect(
      updateIdentity(ctx(), "id-1", { knowledgeBaseIds: [KB_PRIVATE] })
    ).rejects.toBeInstanceOf(IdentityKnowledgeBaseNotFoundError);
    expect(mockRepo.updateIdentityRow).not.toHaveBeenCalled();
  });
});

describe("team sharing — grantability", () => {
  it("a non-admin owner may share only with teams they belong to", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      createIdentity(ctx(), { name: "R", visibility: "team", teamIds: [TEAM_B] })
    ).rejects.toBeInstanceOf(IdentityTeamNotGrantableError);

    await expect(
      createIdentity(ctx(), { name: "R", visibility: "team", teamIds: [TEAM_A] })
    ).resolves.toBeTruthy();
  });

  it("a workspace admin may share with any team in the workspace", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([]);
    await expect(
      createIdentity(ctx({ role: "admin" }), {
        name: "R",
        visibility: "team",
        teamIds: [TEAM_B],
      })
    ).resolves.toBeTruthy();
  });

  it("a team from ANOTHER workspace is refused before the DB trigger sees it", async () => {
    mockRepo.filterTeamIdsInWorkspace.mockResolvedValue([]);
    const err = await createIdentity(ctx({ role: "admin" }), {
      name: "R",
      visibility: "team",
      teamIds: [TEAM_A],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityTeamNotGrantableError);
    // The junction trigger would catch it too, as an opaque 500.
    expect(err.message).toMatch(/Not a team in this workspace/);
  });

  it("SECURITY: an AGENT credential cannot create into `team`, on either path", async () => {
    // The REST schema still accepts `team` (legal for humans), so the service refuses the credential.
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      createIdentity(ctx({ source: "agent" }), {
        name: "R",
        visibility: "team",
        teamIds: [TEAM_A],
      })
    ).rejects.toBeInstanceOf(IdentityTeamScopeAgentForbiddenError);
    expect(mockRepo.insertIdentity).not.toHaveBeenCalled();
  });

  it("SECURITY: …and cannot MOVE a row into `team` in a second call", async () => {
    mockRepo.findIdentityById.mockResolvedValue(identity({ visibility: "private" }));
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      updateIdentity(ctx({ source: "agent" }), "id-1", {
        visibility: "team",
        teamIds: [TEAM_A],
      })
    ).rejects.toBeInstanceOf(IdentityTeamScopeAgentForbiddenError);
    expect(mockRepo.updateIdentityRow).not.toHaveBeenCalled();
  });

  it("SECURITY: a teamIds-only patch on an ALREADY-team row is the same act", async () => {
    // It moves the audience without naming a visibility, so the fence reads the landing value.
    mockRepo.findIdentityById.mockResolvedValue(identity({ visibility: "team" }));
    mockRepo.listTeamLinksForIdentities.mockResolvedValue([
      { identityId: "id-1", teamId: TEAM_A },
    ]);
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A, TEAM_B]);
    await expect(
      updateIdentity(ctx({ source: "agent" }), "id-1", { teamIds: [TEAM_B] })
    ).rejects.toBeInstanceOf(IdentityTeamScopeAgentForbiddenError);
  });

  it("a HUMAN is untouched — the fence is the credential, not the value", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      createIdentity(ctx(), { name: "R", visibility: "team", teamIds: [TEAM_A] })
    ).resolves.toBeTruthy();
  });

  it("an owner may KEEP a team an admin granted, even outside their own teams", async () => {
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "team" })
    );
    mockRepo.listTeamLinksForIdentities.mockResolvedValue([
      { identityId: "id-1", teamId: TEAM_B },
    ]);
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      updateIdentity(ctx(), "id-1", {
        visibility: "team",
        teamIds: [TEAM_A, TEAM_B],
      })
    ).resolves.toBeTruthy();
  });
});

describe("visibility transitions and replace-set semantics", () => {
  it("the owner may move in ANY direction, narrowing included", async () => {
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "workspace" })
    );
    await expect(
      updateIdentity(ctx(), "id-1", { visibility: "private" })
    ).resolves.toBeTruthy();
  });

  it("leaving 'team' CLEARS the links rather than leaving them to reanimate", async () => {
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "team" })
    );
    await updateIdentity(ctx(), "id-1", { visibility: "private" });
    expect(mockRepo.replaceTeamLinks).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      [],
      OWNER
    );
  });

  it("an untouched set is left alone; an EMPTY array empties it", async () => {
    await updateIdentity(ctx(), "id-1", { name: "Renamed" });
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
    expect(mockRepo.replaceTeamLinks).not.toHaveBeenCalled();

    await updateIdentity(ctx(), "id-1", { knowledgeBaseIds: [] });
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      [],
      OWNER
    );
  });
});

describe("write gate — creator or workspace admin, and nobody else", () => {
  const shared = identity({ visibility: "workspace", createdBy: OWNER });

  beforeEach(() => {
    mockRepo.findIdentityById.mockResolvedValue(shared);
  });

  it("a member who can SEE a workspace identity still cannot edit or delete it", async () => {
    const stranger = ctx({ userId: OTHER });
    await expect(
      updateIdentity(stranger, "id-1", { name: "Hijacked" })
    ).rejects.toBeInstanceOf(IdentityWriteForbiddenError);
    await expect(deleteIdentity(stranger, "id-1")).rejects.toBeInstanceOf(
      IdentityWriteForbiddenError
    );
    expect(mockRepo.hardDeleteIdentity).not.toHaveBeenCalled();
  });

  it("a workspace admin may", async () => {
    await expect(
      deleteIdentity(ctx({ userId: OTHER, role: "admin" }), "id-1")
    ).resolves.toBeUndefined();
    expect(mockRepo.hardDeleteIdentity).toHaveBeenCalledWith("ws-1", "id-1");
  });

  it("an INVISIBLE identity 404s before the write gate can 403", async () => {
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "private", createdBy: OWNER })
    );
    // A 403 here would confirm the row exists to someone who may not see it.
    const err = await deleteIdentity(ctx({ userId: OTHER }), "id-1").catch(
      (e) => e
    );
    expect(err).not.toBeInstanceOf(IdentityWriteForbiddenError);
    expect(err.code).toBe("AGENT_IDENTITY_NOT_FOUND");
  });
});

describe("delete is PERMANENT and the junctions ride the FK", () => {
  it("issues one workspace-scoped DELETE and no junction cleanup of its own", async () => {
    await deleteIdentity(ctx(), "id-1");
    expect(mockRepo.hardDeleteIdentity).toHaveBeenCalledWith("ws-1", "id-1");
    // Both junctions cascade via a real FK (`20260822200000`); a hand cascade would miss a new child table.
    expect(mockRepo.replaceTeamLinks).not.toHaveBeenCalled();
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
  });
});

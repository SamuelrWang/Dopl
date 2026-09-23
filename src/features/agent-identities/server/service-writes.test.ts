/**
 * Write invariants: the creator-or-admin gate, the KB attach fence, team-share
 * grantability, replace-set semantics, and the permanent delete.
 *
 * ⚠ THE KB ATTACH BLOCK IS THE SECURITY-CRITICAL ONE. Without it an identity is
 * a laundering channel — attach a teammate's private base by id, flip the
 * identity to `workspace`, and every member's spawned agent gets a pointer to
 * it. Each arm of the mirrored `canSeeBase` predicate is pinned separately
 * because that predicate is a COPY of the knowledge feature's rule and the copy
 * is the one that will not notice when the original moves.
 *
 * Repository mocked; no Supabase, no network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
// 🔒 G16's two reads (`features/workspaces/server/shared-publish.ts`). Every
// create that lands at `workspace` visibility asks them, so a suite that leaves
// them unmocked reaches Supabase and hangs. ⚠ A STANDARD workspace by default —
// this file is about the write gates, and the publish precondition has its own
// suite (`service-acknowledge-shared.test.ts`) that drives the link container.
// ⚠ **THE GRANT ARM IS A DB READ, SO IT IS DECLARED HERE** (F-604, 2026-09-02).
// `canSeeBase` / `canSeeIdentity` gained an arm over `resource_grants`, and its
// batch precompute is the one part of this seam that talks to Postgres. Every
// case in this file is about the OTHER arms, so the grant set is empty — which
// is also the pre-2026-09-02 behaviour, and therefore the right default for a
// suite that predates the arm. The cases that exercise a GRANT live in
// `service-shared-grant-arm.test.ts` and the redteam suites.
vi.mock("@/shared/tenancy/resource-grant-reach", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/shared/tenancy/resource-grant-reach")
  >()),
  grantedResourceIds: vi.fn(async () => new Set<string>()),
}));

// 🔓 **THE WRITE GATE FOLLOWS THE ID SINCE 2026-09-06** (Samuel's ruling;
// `shared/tenancy/read-resource.ts`), so update/delete compose the resolver on a
// MISS in the calling tenancy — and an unmocked resolver reaches Supabase and
// hangs, exactly as the G16 reads above do. ⚠ `null` IS THE RIGHT DEFAULT FOR
// THIS FILE: "nameable nowhere else" is what every case here assumes, and it is
// what keeps the 404-never-403 assertions honest. The cases that exercise a real
// follow live in `service-writes-tenancy.test.ts`.
vi.mock("@/shared/tenancy/resolve-resource", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/shared/tenancy/resolve-resource")
  >()),
  resolveResource: vi.fn(async () => null),
}));

vi.mock("@/features/workspaces/server/repository", () => ({
  findDefaultWorkspaceForUser: vi.fn().mockResolvedValue(null),
  findWorkspaceById: vi.fn().mockResolvedValue({ id: "ws-1", kind: "standard" }),
}));
vi.mock("@/features/workspaces/server/repository-overview", () => ({
  countActiveMembers: vi.fn().mockResolvedValue(1),
}));
vi.mock("./repository", () => ({
  listIdentitiesForWorkspace: vi.fn(),
  findIdentityById: vi.fn(),
  insertIdentity: vi.fn(),
  updateIdentityRow: vi.fn(),
  hardDeleteIdentity: vi.fn(),
  listTeamLinksForIdentities: vi.fn(),
  replaceTeamLinks: vi.fn(),
  listTeamIdsForUser: vi.fn(),
  filterTeamIdsInWorkspace: vi.fn(),
  listKnowledgeLinksForIdentities: vi.fn(),
  replaceKnowledgeLinks: vi.fn(),
  listKnowledgeBaseAccessRows: vi.fn(),
  listKnowledgeBaseTeamGrants: vi.fn(),
  listLiveFoldersForBases: vi.fn(),
  listLiveEntryRows: vi.fn(),
}));

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

// ── Create defaults ──────────────────────────────────────────────────

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

  // ⚠ **F-289 — THE CREATE FENCE WAS DEFEATED IN TWO CALLS.** `updateIdentity` had no API-key
  // check at all, so a workspace-scoped key could POST `workspace` (accepted, `created_by` = the
  // key's user) and then PATCH to `private`: the re-read passes (the row is still `workspace` at
  // read time), `assertMayWrite` passes (the key IS the creator), and the row lands `private` —
  // the exact state the create guard exists to prevent, invisible to the key itself and to every
  // workspace admin. This case is pinned BESIDE the create one deliberately: they are one rule.
  it("…and it cannot reach 'private' by PATCHing afterwards either (F-289)", async () => {
    const keyCtx = ctx({ apiKeyWorkspaceId: "ws-1", credentialSubjectUserId: null });
    const owned = identity({ visibility: "workspace", createdBy: OWNER });
    mockRepo.findIdentityById.mockResolvedValue(owned);
    await expect(
      updateIdentity(keyCtx, "tpl-1", { visibility: "private" })
    ).rejects.toBeInstanceOf(WorkspaceKeyPrivateIdentityError);
    expect(mockRepo.updateIdentityRow).not.toHaveBeenCalled();
  });

  // ⚠ THE GUARD IS ON `nextVisibility` — THE STATE THE ROW LANDS IN — not on the patch key, so a
  // key that already owned a private row could not keep it by patching something else either.
  // In practice it never gets that far: a workspace key cannot READ a private row back (arm 2 of
  // `service-shared.ts › canSeeBaseRow`'s identity twin), so `getIdentityById` 404s BEFORE the
  // fence. Pinned as the 404 it really is, rather than as a fence firing where it cannot.
  it("a workspace key cannot even SEE an already-private identity to PATCH it (F-289)", async () => {
    const keyCtx = ctx({ apiKeyWorkspaceId: "ws-1", credentialSubjectUserId: null });
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "private", createdBy: OWNER })
    );
    await expect(updateIdentity(keyCtx, "tpl-1", { name: "Renamed" })).rejects.toThrow();
    expect(mockRepo.updateIdentityRow).not.toHaveBeenCalled();
  });

  // …and the fence stops exactly there: widening is what a shared key is FOR.
  it("a workspace key may still PATCH a workspace identity (F-289)", async () => {
    const keyCtx = ctx({ apiKeyWorkspaceId: "ws-1", credentialSubjectUserId: null });
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "workspace", createdBy: OWNER })
    );
    await updateIdentity(keyCtx, "tpl-1", { name: "Renamed" });
    expect(mockRepo.updateIdentityRow).toHaveBeenCalled();
  });

  // …and a HUMAN session is untouched by any of it.
  it("a session caller may still make an identity private (F-289)", async () => {
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "workspace", createdBy: OWNER })
    );
    await updateIdentity(ctx(), "tpl-1", { visibility: "private" });
    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
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

// ── The KB attach fence ──────────────────────────────────────────────

describe("KB attach validation — a base you cannot read, you cannot attach", () => {
  it("attaches a workspace-visible base", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);
    await createIdentity(ctx(), {
      name: "R",
      knowledgeBaseIds: [KB_OPEN],
    });
    // ⚠ SCOPES SINCE 2026-09-08. `knowledgeBaseIds` still means WHOLE BASES and
    // is translated at one seam, so a client that never learns about folders
    // sends exactly what it always sent.
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
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
    // ⚠ 404-shaped on purpose: a distinguishable "forbidden" would make this
    // endpoint an existence oracle for other people's private bases.
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
    // There is no transaction across insert + two junction writes, so the
    // ORDER is the atomicity story and it is worth pinning.
    expect(mockRepo.insertIdentity).not.toHaveBeenCalled();
  });

  it("the same fence applies on UPDATE, not only on create", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_PRIVATE]]);
    await expect(
      updateIdentity(ctx(), "tpl-1", { knowledgeBaseIds: [KB_PRIVATE] })
    ).rejects.toBeInstanceOf(IdentityKnowledgeBaseNotFoundError);
    expect(mockRepo.updateIdentityRow).not.toHaveBeenCalled();
  });
});

// ── Team sharing ─────────────────────────────────────────────────────

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
    // The junction's workspace-guard trigger would also catch this, as an
    // opaque 500. Catching it here is what makes the error sayable.
    expect(err.message).toMatch(/Not a team in this workspace/);
  });

  it("SECURITY: an AGENT credential cannot create into `team`, on either path", async () => {
    // 🔒 A8's SERVER HALF (2026-09-02). A8 took `team` off `dopl_agent`'s enum,
    // so the MCP surface refuses it in zod — but the REST route's schema still
    // accepts it and an agent credential reaches that route directly, so the rule
    // held on one road only. It refuses the CREDENTIAL, not the value: `team`
    // stays legal for a human until B4 is ruled, and every stored row keeps
    // working.
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      createIdentity(ctx({ source: "agent" }), {
        name: "R",
        visibility: "team",
        teamIds: [TEAM_A],
      })
    ).rejects.toBeInstanceOf(IdentityTeamScopeAgentForbiddenError);
    // ⚠ REFUSED BEFORE THE ROW, not after: an identity that exists with the wrong
    // sharing is worse than one that was never created.
    expect(mockRepo.insertIdentity).not.toHaveBeenCalled();
  });

  it("SECURITY: …and cannot MOVE a row into `team` in a second call", async () => {
    // ⚠ A create fence with no update twin is a fence defeated in two calls —
    // F-289's own argument on this very service.
    mockRepo.findIdentityById.mockResolvedValue(identity({ visibility: "private" }));
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      updateIdentity(ctx({ source: "agent" }), "tpl-1", {
        visibility: "team",
        teamIds: [TEAM_A],
      })
    ).rejects.toBeInstanceOf(IdentityTeamScopeAgentForbiddenError);
    expect(mockRepo.updateIdentityRow).not.toHaveBeenCalled();
  });

  it("SECURITY: a teamIds-only patch on an ALREADY-team row is the same act", async () => {
    // ⚠ It moves the audience without naming a visibility, which is why the fence
    // reads the LANDING value rather than `patch.visibility`.
    mockRepo.findIdentityById.mockResolvedValue(identity({ visibility: "team" }));
    mockRepo.listTeamLinksForIdentities.mockResolvedValue([
      { identityId: "tpl-1", teamId: TEAM_A },
    ]);
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A, TEAM_B]);
    await expect(
      updateIdentity(ctx({ source: "agent" }), "tpl-1", { teamIds: [TEAM_B] })
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
      { identityId: "tpl-1", teamId: TEAM_B },
    ]);
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      updateIdentity(ctx(), "tpl-1", {
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
      updateIdentity(ctx(), "tpl-1", { visibility: "private" })
    ).resolves.toBeTruthy();
  });

  it("leaving 'team' CLEARS the links rather than leaving them to reanimate", async () => {
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "team" })
    );
    await updateIdentity(ctx(), "tpl-1", { visibility: "private" });
    expect(mockRepo.replaceTeamLinks).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
      [],
      OWNER
    );
  });

  it("an untouched set is left alone; an EMPTY array empties it", async () => {
    await updateIdentity(ctx(), "tpl-1", { name: "Renamed" });
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
    expect(mockRepo.replaceTeamLinks).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockRepo.findIdentityById.mockResolvedValue(identity());
    mockRepo.updateIdentityRow.mockResolvedValue(identity());
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([]);
    mockRepo.listTeamLinksForIdentities.mockResolvedValue([]);
    await updateIdentity(ctx(), "tpl-1", { knowledgeBaseIds: [] });
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
      [],
      OWNER
    );
  });
});

// ── The write gate + the permanent delete ────────────────────────────

describe("write gate — creator or workspace admin, and nobody else", () => {
  const shared = identity({ visibility: "workspace", createdBy: OWNER });

  beforeEach(() => {
    mockRepo.findIdentityById.mockResolvedValue(shared);
  });

  it("a member who can SEE a workspace identity still cannot edit or delete it", async () => {
    const stranger = ctx({ userId: OTHER });
    await expect(
      updateIdentity(stranger, "tpl-1", { name: "Hijacked" })
    ).rejects.toBeInstanceOf(IdentityWriteForbiddenError);
    await expect(deleteIdentity(stranger, "tpl-1")).rejects.toBeInstanceOf(
      IdentityWriteForbiddenError
    );
    expect(mockRepo.hardDeleteIdentity).not.toHaveBeenCalled();
  });

  it("a workspace admin may", async () => {
    await expect(
      deleteIdentity(ctx({ userId: OTHER, role: "admin" }), "tpl-1")
    ).resolves.toBeUndefined();
    expect(mockRepo.hardDeleteIdentity).toHaveBeenCalledWith("ws-1", "tpl-1");
  });

  it("an INVISIBLE identity 404s before the write gate can 403", async () => {
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "private", createdBy: OWNER })
    );
    // A 403 here would confirm the row exists to someone who may not see it.
    const err = await deleteIdentity(ctx({ userId: OTHER }), "tpl-1").catch(
      (e) => e
    );
    expect(err).not.toBeInstanceOf(IdentityWriteForbiddenError);
    expect(err.code).toBe("AGENT_IDENTITY_NOT_FOUND");
  });
});

describe("delete is PERMANENT and the junctions ride the FK", () => {
  it("issues one workspace-scoped DELETE and no junction cleanup of its own", async () => {
    await deleteIdentity(ctx(), "tpl-1");
    expect(mockRepo.hardDeleteIdentity).toHaveBeenCalledWith("ws-1", "tpl-1");
    // ⚠ THE ABSENCE IS THE ASSERTION. Both junctions cascade via a real FK
    // (`20260822200000`); a hand-written cascade here is one that acquires a
    // new child table and forgets it. If these ever start being called, the FK
    // was dropped and this test is the thing that says so.
    expect(mockRepo.replaceTeamLinks).not.toHaveBeenCalled();
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
  });
});

/**
 * Write invariants: the creator-or-admin gate, the KB attach fence, team-share
 * grantability, replace-set semantics, and the permanent delete.
 *
 * ⚠ THE KB ATTACH BLOCK IS THE SECURITY-CRITICAL ONE. Without it a template is
 * a laundering channel — attach a teammate's private base by id, flip the
 * template to `workspace`, and every member's spawned agent gets a pointer to
 * it. Each arm of the mirrored `canSeeBase` predicate is pinned separately
 * because that predicate is a COPY of the knowledge feature's rule and the copy
 * is the one that will not notice when the original moves.
 *
 * Repository mocked; no Supabase, no network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("./repository", () => ({
  listTemplatesForWorkspace: vi.fn(),
  findTemplateById: vi.fn(),
  insertTemplate: vi.fn(),
  updateTemplateRow: vi.fn(),
  hardDeleteTemplate: vi.fn(),
  listTeamLinksForTemplates: vi.fn(),
  replaceTeamLinks: vi.fn(),
  listTeamIdsForUser: vi.fn(),
  filterTeamIdsInWorkspace: vi.fn(),
  listKnowledgeLinksForTemplates: vi.fn(),
  replaceKnowledgeLinks: vi.fn(),
  listKnowledgeBaseAccessRows: vi.fn(),
  listKnowledgeBaseTeamGrants: vi.fn(),
}));

import * as repo from "./repository";
import { createTemplate, deleteTemplate, updateTemplate } from "./service";
import {
  TemplateKnowledgeBaseNotFoundError,
  TemplateTeamNotGrantableError,
  TemplateWriteForbiddenError,
  WorkspaceKeyPrivateTemplateError,
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
  template,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);

beforeEach(() => {
  vi.clearAllMocks();
  resetRepoMocks(mockRepo);
});

// ── Create defaults ──────────────────────────────────────────────────

describe("createTemplate — visibility defaults by caller kind", () => {
  it("a session caller gets 'private' by default", async () => {
    await createTemplate(ctx(), { name: "Researcher" });
    expect(mockRepo.insertTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "private", createdBy: OWNER })
    );
  });

  it("a workspace-scoped API key gets 'workspace' and CANNOT ask for private", async () => {
    const keyCtx = ctx({ apiKeyWorkspaceId: "ws-1" });
    await createTemplate(keyCtx, { name: "Researcher" });
    expect(mockRepo.insertTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "workspace" })
    );
    await expect(
      createTemplate(keyCtx, { name: "X", visibility: "private" })
    ).rejects.toBeInstanceOf(WorkspaceKeyPrivateTemplateError);
  });

  // ⚠ **F-289 — THE CREATE FENCE WAS DEFEATED IN TWO CALLS.** `updateTemplate` had no API-key
  // check at all, so a workspace-scoped key could POST `workspace` (accepted, `created_by` = the
  // key's user) and then PATCH to `private`: the re-read passes (the row is still `workspace` at
  // read time), `assertMayWrite` passes (the key IS the creator), and the row lands `private` —
  // the exact state the create guard exists to prevent, invisible to the key itself and to every
  // workspace admin. This case is pinned BESIDE the create one deliberately: they are one rule.
  it("…and it cannot reach 'private' by PATCHing afterwards either (F-289)", async () => {
    const keyCtx = ctx({ apiKeyWorkspaceId: "ws-1" });
    const owned = template({ visibility: "workspace", createdBy: OWNER });
    mockRepo.findTemplateById.mockResolvedValue(owned);
    await expect(
      updateTemplate(keyCtx, "tpl-1", { visibility: "private" })
    ).rejects.toBeInstanceOf(WorkspaceKeyPrivateTemplateError);
    expect(mockRepo.updateTemplateRow).not.toHaveBeenCalled();
  });

  // ⚠ THE GUARD IS ON `nextVisibility` — THE STATE THE ROW LANDS IN — not on the patch key, so a
  // key that already owned a private row could not keep it by patching something else either.
  // In practice it never gets that far: a workspace key cannot READ a private row back (arm 2 of
  // `service-shared.ts › canSeeBaseRow`'s template twin), so `getTemplateById` 404s BEFORE the
  // fence. Pinned as the 404 it really is, rather than as a fence firing where it cannot.
  it("a workspace key cannot even SEE an already-private template to PATCH it (F-289)", async () => {
    const keyCtx = ctx({ apiKeyWorkspaceId: "ws-1" });
    mockRepo.findTemplateById.mockResolvedValue(
      template({ visibility: "private", createdBy: OWNER })
    );
    await expect(updateTemplate(keyCtx, "tpl-1", { name: "Renamed" })).rejects.toThrow();
    expect(mockRepo.updateTemplateRow).not.toHaveBeenCalled();
  });

  // …and the fence stops exactly there: widening is what a shared key is FOR.
  it("a workspace key may still PATCH a workspace template (F-289)", async () => {
    const keyCtx = ctx({ apiKeyWorkspaceId: "ws-1" });
    mockRepo.findTemplateById.mockResolvedValue(
      template({ visibility: "workspace", createdBy: OWNER })
    );
    await updateTemplate(keyCtx, "tpl-1", { name: "Renamed" });
    expect(mockRepo.updateTemplateRow).toHaveBeenCalled();
  });

  // …and a HUMAN session is untouched by any of it.
  it("a session caller may still make a template private (F-289)", async () => {
    mockRepo.findTemplateById.mockResolvedValue(
      template({ visibility: "workspace", createdBy: OWNER })
    );
    await updateTemplate(ctx(), "tpl-1", { visibility: "private" });
    expect(mockRepo.updateTemplateRow).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
      expect.objectContaining({ visibility: "private" })
    );
  });

  it("empty prose is stored as NULL, not as an empty string", async () => {
    await createTemplate(ctx(), {
      name: "Researcher",
      description: "   ",
      instructions: "",
    });
    expect(mockRepo.insertTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ description: null, instructions: null })
    );
  });
});

// ── The KB attach fence ──────────────────────────────────────────────

describe("KB attach validation — a base you cannot read, you cannot attach", () => {
  it("attaches a workspace-visible base", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);
    await createTemplate(ctx(), {
      name: "R",
      knowledgeBaseIds: [KB_OPEN],
    });
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
      [KB_OPEN],
      OWNER
    );
  });

  it("REFUSES someone else's private base — and 404s rather than 403s", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_PRIVATE]]);
    const err = await createTemplate(ctx(), {
      name: "R",
      knowledgeBaseIds: [KB_PRIVATE],
    }).catch((e) => e);
    // ⚠ 404-shaped on purpose: a distinguishable "forbidden" would make this
    // endpoint an existence oracle for other people's private bases.
    expect(err).toBeInstanceOf(TemplateKnowledgeBaseNotFoundError);
    expect(err.missingIds).toEqual([KB_PRIVATE]);
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
  });

  it("allows the OWNER of a private base to attach their own", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      { ...BASES[KB_PRIVATE], createdBy: OWNER },
    ]);
    await expect(
      createTemplate(ctx(), { name: "R", knowledgeBaseIds: [KB_PRIVATE] })
    ).resolves.toBeTruthy();
  });

  it("REFUSES a teams-mode base the caller has no team on", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_TEAM]]);
    mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([
      { knowledgeBaseId: KB_TEAM, teamId: TEAM_A },
    ]);
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_B]);
    await expect(
      createTemplate(ctx(), { name: "R", knowledgeBaseIds: [KB_TEAM] })
    ).rejects.toBeInstanceOf(TemplateKnowledgeBaseNotFoundError);
  });

  it("ALLOWS a teams-mode base the caller shares a team with", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_TEAM]]);
    mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([
      { knowledgeBaseId: KB_TEAM, teamId: TEAM_A },
    ]);
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      createTemplate(ctx(), { name: "R", knowledgeBaseIds: [KB_TEAM] })
    ).resolves.toBeTruthy();
  });

  it("REFUSES an id that does not resolve at all (deleted, or another workspace)", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
    await expect(
      createTemplate(ctx(), { name: "R", knowledgeBaseIds: [KB_OPEN] })
    ).rejects.toBeInstanceOf(TemplateKnowledgeBaseNotFoundError);
  });

  it("VALIDATES BEFORE INSERTING — a rejected attach leaves no template behind", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_PRIVATE]]);
    await createTemplate(ctx(), {
      name: "R",
      knowledgeBaseIds: [KB_PRIVATE],
    }).catch(() => undefined);
    // There is no transaction across insert + two junction writes, so the
    // ORDER is the atomicity story and it is worth pinning.
    expect(mockRepo.insertTemplate).not.toHaveBeenCalled();
  });

  it("the same fence applies on UPDATE, not only on create", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_PRIVATE]]);
    await expect(
      updateTemplate(ctx(), "tpl-1", { knowledgeBaseIds: [KB_PRIVATE] })
    ).rejects.toBeInstanceOf(TemplateKnowledgeBaseNotFoundError);
    expect(mockRepo.updateTemplateRow).not.toHaveBeenCalled();
  });
});

// ── Team sharing ─────────────────────────────────────────────────────

describe("team sharing — grantability", () => {
  it("a non-admin owner may share only with teams they belong to", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      createTemplate(ctx(), { name: "R", visibility: "team", teamIds: [TEAM_B] })
    ).rejects.toBeInstanceOf(TemplateTeamNotGrantableError);

    await expect(
      createTemplate(ctx(), { name: "R", visibility: "team", teamIds: [TEAM_A] })
    ).resolves.toBeTruthy();
  });

  it("a workspace admin may share with any team in the workspace", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([]);
    await expect(
      createTemplate(ctx({ role: "admin" }), {
        name: "R",
        visibility: "team",
        teamIds: [TEAM_B],
      })
    ).resolves.toBeTruthy();
  });

  it("a team from ANOTHER workspace is refused before the DB trigger sees it", async () => {
    mockRepo.filterTeamIdsInWorkspace.mockResolvedValue([]);
    const err = await createTemplate(ctx({ role: "admin" }), {
      name: "R",
      visibility: "team",
      teamIds: [TEAM_A],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateTeamNotGrantableError);
    // The junction's workspace-guard trigger would also catch this, as an
    // opaque 500. Catching it here is what makes the error sayable.
    expect(err.message).toMatch(/Not a team in this workspace/);
  });

  it("an owner may KEEP a team an admin granted, even outside their own teams", async () => {
    mockRepo.findTemplateById.mockResolvedValue(
      template({ visibility: "team" })
    );
    mockRepo.listTeamLinksForTemplates.mockResolvedValue([
      { templateId: "tpl-1", teamId: TEAM_B },
    ]);
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      updateTemplate(ctx(), "tpl-1", {
        visibility: "team",
        teamIds: [TEAM_A, TEAM_B],
      })
    ).resolves.toBeTruthy();
  });
});

describe("visibility transitions and replace-set semantics", () => {
  it("the owner may move in ANY direction, narrowing included", async () => {
    mockRepo.findTemplateById.mockResolvedValue(
      template({ visibility: "workspace" })
    );
    await expect(
      updateTemplate(ctx(), "tpl-1", { visibility: "private" })
    ).resolves.toBeTruthy();
  });

  it("leaving 'team' CLEARS the links rather than leaving them to reanimate", async () => {
    mockRepo.findTemplateById.mockResolvedValue(
      template({ visibility: "team" })
    );
    await updateTemplate(ctx(), "tpl-1", { visibility: "private" });
    expect(mockRepo.replaceTeamLinks).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
      [],
      OWNER
    );
  });

  it("an untouched set is left alone; an EMPTY array empties it", async () => {
    await updateTemplate(ctx(), "tpl-1", { name: "Renamed" });
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
    expect(mockRepo.replaceTeamLinks).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockRepo.findTemplateById.mockResolvedValue(template());
    mockRepo.updateTemplateRow.mockResolvedValue(template());
    mockRepo.listKnowledgeLinksForTemplates.mockResolvedValue([]);
    mockRepo.listTeamLinksForTemplates.mockResolvedValue([]);
    await updateTemplate(ctx(), "tpl-1", { knowledgeBaseIds: [] });
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
  const shared = template({ visibility: "workspace", createdBy: OWNER });

  beforeEach(() => {
    mockRepo.findTemplateById.mockResolvedValue(shared);
  });

  it("a member who can SEE a workspace template still cannot edit or delete it", async () => {
    const stranger = ctx({ userId: OTHER });
    await expect(
      updateTemplate(stranger, "tpl-1", { name: "Hijacked" })
    ).rejects.toBeInstanceOf(TemplateWriteForbiddenError);
    await expect(deleteTemplate(stranger, "tpl-1")).rejects.toBeInstanceOf(
      TemplateWriteForbiddenError
    );
    expect(mockRepo.hardDeleteTemplate).not.toHaveBeenCalled();
  });

  it("a workspace admin may", async () => {
    await expect(
      deleteTemplate(ctx({ userId: OTHER, role: "admin" }), "tpl-1")
    ).resolves.toBeUndefined();
    expect(mockRepo.hardDeleteTemplate).toHaveBeenCalledWith("ws-1", "tpl-1");
  });

  it("an INVISIBLE template 404s before the write gate can 403", async () => {
    mockRepo.findTemplateById.mockResolvedValue(
      template({ visibility: "private", createdBy: OWNER })
    );
    // A 403 here would confirm the row exists to someone who may not see it.
    const err = await deleteTemplate(ctx({ userId: OTHER }), "tpl-1").catch(
      (e) => e
    );
    expect(err).not.toBeInstanceOf(TemplateWriteForbiddenError);
    expect(err.code).toBe("AGENT_TEMPLATE_NOT_FOUND");
  });
});

describe("delete is PERMANENT and the junctions ride the FK", () => {
  it("issues one workspace-scoped DELETE and no junction cleanup of its own", async () => {
    await deleteTemplate(ctx(), "tpl-1");
    expect(mockRepo.hardDeleteTemplate).toHaveBeenCalledWith("ws-1", "tpl-1");
    // ⚠ THE ABSENCE IS THE ASSERTION. Both junctions cascade via a real FK
    // (`20260822200000`); a hand-written cascade here is one that acquires a
    // new child table and forgets it. If these ever start being called, the FK
    // was dropped and this test is the thing that says so.
    expect(mockRepo.replaceTeamLinks).not.toHaveBeenCalled();
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
  });
});

/**
 * ⚠ **THE KB-ATTACH 500 (F-404).** `dopl_agent(op="update", knowledge_bases=[…])`
 * names no scalar column, so the patch handed to `updateIdentityRow` was six
 * `undefined`s — an empty UPDATE body PostgREST rejects, thrown raw, unmapped by
 * `http-mapping.ts`, surfacing as INTERNAL_ERROR 500 on a valid request. The
 * junction write, which was the entire point of the call, never ran.
 *
 * ⚠ A SIBLING OF `service-writes.test.ts`, sharing its harness through
 * `service-writes-fixtures.ts` — the two are separate files because one was over
 * the 500-line cap, and a second copy of the harness would have been a
 * duplicate made for a formatting reason.
 *
 * ⚠ THE REPOSITORY IS MOCKED HERE, so what this file proves is that the SERVICE
 * does not issue the write. That the repository is ALSO total on an empty patch
 * — the half that actually reached PostgREST — is proved against a recording
 * client in `repository.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// 🔒 THE TEAM-SCOPE CONTAINER CHECK IS A DB READ (Samuel's ruling 2026-09-08,
// `service-write-gates.ts › assertTeamScopeGrantable`) — unmocked it reaches
// Supabase and hangs. Every case here is a STANDARD workspace, which is what
// this suite has always meant by "ws-1".
vi.mock("@/features/workspaces/server/repository", () => ({
  findDefaultWorkspaceForUser: vi.fn().mockResolvedValue(null),
  findWorkspaceById: vi.fn().mockResolvedValue({ id: "ws-1", kind: "standard" }),
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
import { updateIdentity } from "./service";
import {
  KB_OPEN,
  OTHER,
  OWNER,
  TEAM_A,
  ctx,
  resetRepoMocks,
  identity,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);

beforeEach(() => {
  vi.clearAllMocks();
  resetRepoMocks(mockRepo);
});

describe("a junction-only patch never reaches the row write", () => {
  it("a knowledgeBaseIds-only attach round-trips and issues NO row update", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      { id: KB_OPEN, workspaceId: "ws-1", visibility: "workspace", createdBy: OTHER },
    ] as never);
    mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([] as never);

    await expect(
      updateIdentity(ctx(), "tpl-1", { knowledgeBaseIds: [KB_OPEN] })
    ).resolves.toBeTruthy();

    expect(mockRepo.updateIdentityRow).not.toHaveBeenCalled();
    // ⚠ THE REPOSITORY TAKES SCOPES SINCE 2026-09-08. The older
    // `knowledgeBaseIds` key still means WHOLE BASES and is translated at one
    // seam (`service-writes.ts › requestedKnowledgeScopes`), so a client that
    // never learns about folders sends exactly what it always sent.
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
      [{ baseId: KB_OPEN, scope: "base" }],
      OWNER
    );
  });

  it("a teamIds-only patch is the same shape and is skipped the same way", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    mockRepo.filterTeamIdsInWorkspace.mockResolvedValue([TEAM_A]);
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "team", teamIds: [TEAM_A] })
    );

    await updateIdentity(ctx(), "tpl-1", { teamIds: [TEAM_A] });

    expect(mockRepo.updateIdentityRow).not.toHaveBeenCalled();
    expect(mockRepo.replaceTeamLinks).toHaveBeenCalled();
  });

  it("but ANY scalar in the patch still writes the row", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      { id: KB_OPEN, workspaceId: "ws-1", visibility: "workspace", createdBy: OTHER },
    ] as never);
    mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([] as never);

    await updateIdentity(ctx(), "tpl-1", {
      name: "Renamed",
      knowledgeBaseIds: [KB_OPEN],
    });

    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
      expect.objectContaining({ name: "Renamed" })
    );
  });

  it("clearing a nullable column is a SCALAR change, not an empty patch", async () => {
    await updateIdentity(ctx(), "tpl-1", { description: null });

    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
      expect.objectContaining({ description: null })
    );
  });
});

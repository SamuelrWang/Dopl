/**
 * The attach gate for a folder or entry scope (`service-knowledge-scopes.ts`). Unreadable base, folder in
 * another base and trashed entry are one 404: distinguishable shapes would be an oracle for others' filing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/tenancy/resource-grant-reach", async (orig) =>
  (await import("./service-writes-fixtures")).noGrantsMock(orig)
);
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
import { createIdentity } from "./service";
import { IdentityKnowledgeBaseNotFoundError } from "./errors";
import {
  BASES,
  KB_OPEN,
  KB_PRIVATE,
  OWNER,
  ctx,
  resetRepoMocks,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);

const FOLDER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ENTRY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

beforeEach(() => {
  vi.clearAllMocks();
  resetRepoMocks(mockRepo);
});

describe("a folder or an entry you cannot read, you cannot attach", () => {
  it("REFUSES a folder from ANOTHER base — 404, naming the folder the caller passed", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);
    mockRepo.listLiveFoldersForBases.mockResolvedValue([
      { id: FOLDER, knowledgeBaseId: KB_PRIVATE, parentId: null, name: "Elsewhere" },
    ]);
    const err = await createIdentity(ctx(), {
      name: "R",
      knowledge: [{ baseId: KB_OPEN, scope: "folder", folderId: FOLDER }],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityKnowledgeBaseNotFoundError);
    expect(err.missingIds).toEqual([FOLDER]);
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
  });

  it("REFUSES a TRASHED entry — the live read simply does not return it", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);
    mockRepo.listLiveEntryRows.mockResolvedValue([]);
    const err = await createIdentity(ctx(), {
      name: "R",
      knowledge: [{ baseId: KB_OPEN, scope: "entry", entryId: ENTRY }],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityKnowledgeBaseNotFoundError);
    expect(err.missingIds).toEqual([ENTRY]);
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
  });

  it("ATTACHES a folder that does live in the named base", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);
    mockRepo.listLiveFoldersForBases.mockResolvedValue([
      { id: FOLDER, knowledgeBaseId: KB_OPEN, parentId: null, name: "Deploys" },
    ]);
    await createIdentity(ctx(), {
      name: "R",
      knowledge: [{ baseId: KB_OPEN, scope: "folder", folderId: FOLDER }],
    });
    // One row naming the folder, never a snapshot of its children.
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      [{ baseId: KB_OPEN, scope: "folder", folderId: FOLDER }],
      OWNER
    );
  });
});

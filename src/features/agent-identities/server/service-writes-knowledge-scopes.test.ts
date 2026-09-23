/**
 * 🔒 THE ATTACH GATE, ONE LEVEL DEEPER — a FOLDER or an ENTRY, not just a base
 * (2026-09-08, Samuel: *"I want to be able to specific folders or entries/files"*).
 *
 * ⚠ **ITS OWN FILE, AND THE REASON IS §1's 500-LINE CAP.**
 * `service-writes.test.ts` crossed it when these cases landed
 * (`eslint.config.mjs › max-lines`, `error`). The seam is the one the SOURCE
 * already cut on the same day: the scope resolver and its gate live in
 * `service-knowledge-scopes.ts`, lifted out of `service-writes.ts` at that exact
 * cap — that file owns WHICH CALLER MAY WRITE, this one owns WHAT A SUB-BASE
 * POINTER HAS TO PROVE.
 *
 * ⚠ **THE ANSWER IS THE SAME 404 IN EVERY ARM, AND THAT IS THE POINT.** "You may
 * not read that base", "that folder is in a different base" and "that entry is
 * in the trash" are one refusal: three distinguishable shapes would make the
 * attach endpoint an oracle for somebody else's filing.
 *
 * ⚠ MUTATION-VERIFIED (2026-09-08): dropping the resolver's
 * `folder.knowledgeBaseId !== scope.baseId` test, or the gate's `missing.length`
 * throw, each turns cases here red.
 *
 * Repository mocked; no Supabase, no network. The harness is the shared fixture
 * module, so the two suites cannot disagree about what a base row looks like.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/tenancy/resource-grant-reach", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/shared/tenancy/resource-grant-reach")
  >()),
  grantedResourceIds: vi.fn(async () => new Set<string>()),
}));
vi.mock("@/shared/tenancy/resolve-resource", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/tenancy/resolve-resource")>()),
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
  listLiveFoldersForBases: vi.fn(),
  listLiveEntryRows: vi.fn(),
}));

import * as repo from "./repository";
import { createTemplate } from "./service";
import { TemplateKnowledgeBaseNotFoundError } from "./errors";
import {
  BASES,
  KB_OPEN,
  KB_PRIVATE,
  OWNER,
  ctx,
  resetRepoMocks,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);

/** ⚠ Sub-base ids, local: the shared fixture holds BASE rows, and a folder is
 *  not a base. */
const FOLDER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ENTRY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

beforeEach(() => {
  vi.clearAllMocks();
  resetRepoMocks(mockRepo);
});

describe("a folder or an entry you cannot read, you cannot attach", () => {
  /**
   * 🔒 **THE GATE GOES ONE LEVEL DEEPER SINCE 2026-09-08, AND ANSWERS THE SAME
   * WAY.** A folder that lives in a DIFFERENT base than the scope names is a
   * fact about somebody else's base; a distinguishable "that folder exists but
   * is elsewhere" would make the attach endpoint an oracle for it. Same error
   * class, same 404 shape, and the id it names is the one the caller passed.
   */
  it("REFUSES a folder from ANOTHER base — 404, naming the folder the caller passed", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);
    mockRepo.listLiveFoldersForBases.mockResolvedValue([
      { id: FOLDER, knowledgeBaseId: KB_PRIVATE, parentId: null, name: "Elsewhere" },
    ]);
    const err = await createTemplate(ctx(), {
      name: "R",
      knowledge: [{ baseId: KB_OPEN, scope: "folder", folderId: FOLDER }],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateKnowledgeBaseNotFoundError);
    expect(err.missingIds).toEqual([FOLDER]);
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
  });

  it("REFUSES a TRASHED entry — the live read simply does not return it", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);
    mockRepo.listLiveEntryRows.mockResolvedValue([]);
    const err = await createTemplate(ctx(), {
      name: "R",
      knowledge: [{ baseId: KB_OPEN, scope: "entry", entryId: ENTRY }],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateKnowledgeBaseNotFoundError);
    expect(err.missingIds).toEqual([ENTRY]);
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
  });

  it("ATTACHES a folder that does live in the named base", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);
    mockRepo.listLiveFoldersForBases.mockResolvedValue([
      { id: FOLDER, knowledgeBaseId: KB_OPEN, parentId: null, name: "Deploys" },
    ]);
    await createTemplate(ctx(), {
      name: "R",
      knowledge: [{ baseId: KB_OPEN, scope: "folder", folderId: FOLDER }],
    });
    // ⚠ ONE ROW NAMING THE FOLDER — never an expansion of its children. An
    // expansion is a snapshot, and an entry filed tomorrow would silently not be
    // attached.
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
      [{ baseId: KB_OPEN, scope: "folder", folderId: FOLDER }],
      OWNER
    );
  });});

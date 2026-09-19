/**
 * `updateTemplate`'s OPTIMISTIC-CONCURRENCY arm (F-739, 2026-09-18).
 *
 * ⚠ **THE SERVICE'S JOB HERE IS THE THREE THINGS THE REPOSITORY CANNOT DO**:
 * hand the version down as a precondition rather than comparing it to the row it
 * already read, turn a lost race into `TemplateStaleVersionError` with the
 * version the row ACTUALLY holds, and refuse BEFORE either junction replacement
 * — there is no transaction across those statements, so a refusal that landed
 * after them would leave the links moved and the columns not.
 *
 * The CAS itself is `repository.test.ts`; this file never touches Postgres.
 *
 * ⚠ A SEPARATE FILE FROM `service-writes.test.ts` FOR THE 500-LINE CAP, which
 * is the same reason `service-writes-junction.test.ts` exists — the harness is
 * shared through `service-writes-fixtures.ts` so the two cannot drift.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/tenancy/resource-grant-reach", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/shared/tenancy/resource-grant-reach")
  >()),
  grantedResourceIds: vi.fn(async () => new Set<string>()),
}));
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
import { updateTemplate } from "./service";
import { TemplateStaleVersionError } from "./errors";
import {
  BASES,
  KB_OPEN,
  ctx,
  resetRepoMocks,
  template,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);
/** The `updatedAt` the fixture row carries — a version a caller really read. */
const VERSION = "2026-01-01T00:00:00Z";
const MOVED = "2026-01-01T00:00:09Z";

beforeEach(() => {
  vi.clearAllMocks();
  resetRepoMocks(mockRepo);
  mockRepo.findTemplateById.mockResolvedValue(template());
  // ⚠ THE ATTACH GATE IS UPSTREAM OF EVERY CASE HERE, so the one base these
  // tests name has to be visible — otherwise a junction-only patch refuses for
  // a reason this file is not about.
  mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);
});

describe("updateTemplate — the version is a PRECONDITION, not a comparison", () => {
  it("hands it to the repository instead of checking it against the row it read", async () => {
    mockRepo.updateTemplateRow.mockResolvedValue(template({ name: "Renamed" }));

    await updateTemplate(ctx(), "tpl-1", { name: "Renamed" }, VERSION);

    // ⚠ THE FOURTH ARGUMENT IS THE WHOLE ASSERTION. A check-then-act would
    // have called the 3-arg overload and compared `existing.updatedAt` itself.
    expect(mockRepo.updateTemplateRow).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
      expect.objectContaining({ name: "Renamed" }),
      VERSION
    );
  });

  it("turns a lost race into a 412-shaped error carrying the version the row now holds", async () => {
    mockRepo.updateTemplateRow.mockResolvedValue(null);
    mockRepo.findTemplateById.mockResolvedValue(template({ updatedAt: MOVED }));

    const failed = updateTemplate(ctx(), "tpl-1", { name: "Renamed" }, VERSION);

    await expect(failed).rejects.toBeInstanceOf(TemplateStaleVersionError);
    await expect(failed).rejects.toMatchObject({
      code: "AGENT_TEMPLATE_STALE_VERSION",
      expected: VERSION,
      actual: MOVED,
    });
  });

  it("writes NEITHER junction when the precondition fails", async () => {
    mockRepo.updateTemplateRow.mockResolvedValue(null);

    await expect(
      updateTemplate(
        ctx(),
        "tpl-1",
        { visibility: "workspace", knowledgeBaseIds: [KB_OPEN] },
        VERSION
      )
    ).rejects.toBeInstanceOf(TemplateStaleVersionError);

    expect(mockRepo.replaceTeamLinks).not.toHaveBeenCalled();
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
  });

  it("fences a JUNCTION-ONLY patch too — the F-404 skip yields to a stated version", async () => {
    mockRepo.updateTemplateRow.mockResolvedValue(null);

    await expect(
      updateTemplate(ctx(), "tpl-1", { knowledgeBaseIds: [KB_OPEN] }, VERSION)
    ).rejects.toBeInstanceOf(TemplateStaleVersionError);

    expect(mockRepo.updateTemplateRow).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
      expect.anything(),
      VERSION
    );
  });
});

describe("updateTemplate — STALE PAYLOAD: a caller that sends no version", () => {
  it("keeps last-writer-wins, and calls the 3-argument overload it always called", async () => {
    mockRepo.updateTemplateRow.mockResolvedValue(template({ name: "Renamed" }));

    await updateTemplate(ctx(), "tpl-1", { name: "Renamed" });

    expect(mockRepo.updateTemplateRow).toHaveBeenCalledWith(
      "ws-1",
      "tpl-1",
      expect.objectContaining({ name: "Renamed" })
    );
    // ⚠ EXACTLY THREE. An older bundled client cannot send the header, and a
    // fourth `undefined` here would mean the CAS overload had been chosen.
    expect(mockRepo.updateTemplateRow.mock.calls[0]).toHaveLength(3);
  });

  it("still SKIPS the row write for a junction-only patch (F-404 is untouched)", async () => {
    await updateTemplate(ctx(), "tpl-1", { knowledgeBaseIds: [KB_OPEN] });

    expect(mockRepo.updateTemplateRow).not.toHaveBeenCalled();
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalled();
  });
});

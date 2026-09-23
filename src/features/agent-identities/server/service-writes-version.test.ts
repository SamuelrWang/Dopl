/**
 * `updateIdentity`'s OPTIMISTIC-CONCURRENCY arm (F-747, 2026-09-18).
 *
 * ⚠ **THE SERVICE'S JOB HERE IS THE THREE THINGS THE REPOSITORY CANNOT DO**:
 * hand the version down as a precondition rather than comparing it to the row it
 * already read, turn a lost race into `IdentityStaleVersionError` with the
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
import { updateIdentity } from "./service";
import { IdentityStaleVersionError } from "./errors";
import {
  BASES,
  KB_OPEN,
  ctx,
  resetRepoMocks,
  identity,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);
/** The `updatedAt` the fixture row carries — a version a caller really read. */
const VERSION = "2026-01-01T00:00:00Z";
const MOVED = "2026-01-01T00:00:09Z";

beforeEach(() => {
  vi.clearAllMocks();
  resetRepoMocks(mockRepo);
  mockRepo.findIdentityById.mockResolvedValue(identity());
  // ⚠ THE ATTACH GATE IS UPSTREAM OF EVERY CASE HERE, so the one base these
  // tests name has to be visible — otherwise a junction-only patch refuses for
  // a reason this file is not about.
  mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);
});

describe("updateIdentity — the version is a PRECONDITION, not a comparison", () => {
  it("hands it to the repository instead of checking it against the row it read", async () => {
    mockRepo.updateIdentityRow.mockResolvedValue(identity({ name: "Renamed" }));

    await updateIdentity(ctx(), "id-1", { name: "Renamed" }, VERSION);

    // ⚠ THE FOURTH ARGUMENT IS THE WHOLE ASSERTION. A check-then-act would
    // have called the 3-arg overload and compared `existing.updatedAt` itself.
    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      expect.objectContaining({ name: "Renamed" }),
      VERSION
    );
  });

  it("turns a lost race into a 412-shaped error carrying the version the row now holds", async () => {
    mockRepo.updateIdentityRow.mockResolvedValue(null);
    mockRepo.findIdentityById.mockResolvedValue(identity({ updatedAt: MOVED }));

    const failed = updateIdentity(ctx(), "id-1", { name: "Renamed" }, VERSION);

    await expect(failed).rejects.toBeInstanceOf(IdentityStaleVersionError);
    await expect(failed).rejects.toMatchObject({
      code: "AGENT_IDENTITY_STALE_VERSION",
      expected: VERSION,
      actual: MOVED,
    });
  });

  it("writes NEITHER junction when the precondition fails", async () => {
    mockRepo.updateIdentityRow.mockResolvedValue(null);

    await expect(
      updateIdentity(
        ctx(),
        "id-1",
        { visibility: "workspace", knowledgeBaseIds: [KB_OPEN] },
        VERSION
      )
    ).rejects.toBeInstanceOf(IdentityStaleVersionError);

    expect(mockRepo.replaceTeamLinks).not.toHaveBeenCalled();
    expect(mockRepo.replaceKnowledgeLinks).not.toHaveBeenCalled();
  });

  it("a JUNCTION-ONLY patch with a version is an UPDATE, so the CAS also BUMPS the version", async () => {
    mockRepo.updateIdentityRow.mockResolvedValue(identity({ updatedAt: MOVED }));

    await updateIdentity(ctx(), "id-1", { knowledgeBaseIds: [KB_OPEN] }, VERSION);

    // A same-value rename: an empty patch would be a SELECT and leave `updated_at` alone,
    // so a second writer holding VERSION would pass and silently replace this set.
    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      expect.objectContaining({ name: identity().name }),
      VERSION
    );
  });

  it("fences a JUNCTION-ONLY patch too — the F-404 skip yields to a stated version", async () => {
    mockRepo.updateIdentityRow.mockResolvedValue(null);

    await expect(
      updateIdentity(ctx(), "id-1", { knowledgeBaseIds: [KB_OPEN] }, VERSION)
    ).rejects.toBeInstanceOf(IdentityStaleVersionError);

    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      expect.anything(),
      VERSION
    );
  });
});

describe("updateIdentity — STALE PAYLOAD: a caller that sends no version", () => {
  it("keeps last-writer-wins, and calls the 3-argument overload it always called", async () => {
    mockRepo.updateIdentityRow.mockResolvedValue(identity({ name: "Renamed" }));

    await updateIdentity(ctx(), "id-1", { name: "Renamed" });

    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      expect.objectContaining({ name: "Renamed" })
    );
    // ⚠ EXACTLY THREE. An older bundled client cannot send the header, and a
    // fourth `undefined` here would mean the CAS overload had been chosen.
    expect(mockRepo.updateIdentityRow.mock.calls[0]).toHaveLength(3);
  });

  it("still bumps the row for a junction-only patch, with a non-empty body", async () => {
    await updateIdentity(ctx(), "id-1", { knowledgeBaseIds: [KB_OPEN] });

    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      expect.objectContaining({ name: identity().name })
    );
    expect(mockRepo.updateIdentityRow.mock.calls[0]).toHaveLength(3);
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalled();
  });
});

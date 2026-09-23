/**
 * `updateIdentity`'s optimistic concurrency (F-747): the version goes down as a precondition, a lost race
 * reports the row's real version, and nothing is refused after a junction write (no transaction spans
 * them). The CAS itself is `repository.test.ts`.
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
  // The attach gate runs first, so the one base these cases name must be visible.
  mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);
});

describe("updateIdentity — the version is a PRECONDITION, not a comparison", () => {
  it("hands it to the repository instead of checking it against the row it read", async () => {
    mockRepo.updateIdentityRow.mockResolvedValue(identity({ name: "Renamed" }));

    await updateIdentity(ctx(), "id-1", { name: "Renamed" }, VERSION);

    // The fourth argument is the assertion: a check-then-act would call the 3-arg overload.
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
    // Exactly three: a fourth `undefined` would mean the CAS overload was chosen.
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

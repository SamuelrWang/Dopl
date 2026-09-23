/**
 * A junction-only patch never reaches `updateIdentityRow` as an empty body, which PostgREST rejects as a
 * raw 500 (F-404). The repository's own empty-patch handling is `repository.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// The team-scope gate reads the workspace row (`service-write-gates.ts › assertTeamScopeGrantable`).
vi.mock("@/features/workspaces/server/repository", async () =>
  (await import("./service-writes-fixtures")).workspaceRepoMock()
);
vi.mock("./repository", async () => (await import("./service-writes-fixtures")).repoMock());

import * as repo from "./repository";
import { updateIdentity } from "./service";
import {
  BASES,
  KB_OPEN,
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

/** The row's own name: the UPDATE fires the touch trigger and is never an empty body. */
const SAME_NAME_ONLY = {
  name: "Researcher",
  description: undefined,
  instructions: undefined,
  model: undefined,
  runtime: undefined,
  fields: undefined,
  visibility: undefined,
};

describe("a junction-only patch versions the row with a same-value UPDATE", () => {
  it("a knowledgeBaseIds-only attach round-trips and bumps the row, never an empty body", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);

    await expect(
      updateIdentity(ctx(), "id-1", { knowledgeBaseIds: [KB_OPEN] })
    ).resolves.toBeTruthy();

    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith("ws-1", "id-1", SAME_NAME_ONLY);
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      [{ baseId: KB_OPEN, scope: "base" }],
      OWNER
    );
  });

  it("a teamIds-only patch is the same shape and bumps the row the same way", async () => {
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    mockRepo.filterTeamIdsInWorkspace.mockResolvedValue([TEAM_A]);
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "team", teamIds: [TEAM_A] })
    );

    await updateIdentity(ctx(), "id-1", { teamIds: [TEAM_A] });

    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith("ws-1", "id-1", SAME_NAME_ONLY);
    expect(mockRepo.replaceTeamLinks).toHaveBeenCalled();
  });

  it("but ANY scalar in the patch still writes the row", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_OPEN]]);

    await updateIdentity(ctx(), "id-1", {
      name: "Renamed",
      knowledgeBaseIds: [KB_OPEN],
    });

    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      expect.objectContaining({ name: "Renamed" })
    );
  });

  it("clearing a nullable column is a SCALAR change, not an empty patch", async () => {
    await updateIdentity(ctx(), "id-1", { description: null });

    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      expect.objectContaining({ description: null })
    );
  });
});

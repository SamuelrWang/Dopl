/**
 * The attach gate's grant arm (F-604): a private base lent into a scope the caller is in is
 * attachable, exactly as `knowledge › canSeeBase` and `dopl_knowledge_base_readable()` read it.
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

import { grantedResourceIds } from "@/shared/tenancy/resource-grant-reach";
import * as repo from "./repository";
import { createIdentity } from "./service";
import { IdentityKnowledgeBaseNotFoundError } from "./errors";
import {
  BASES,
  KB_PRIVATE,
  OWNER,
  TEAM_A,
  TEAM_B,
  ctx,
  resetRepoMocks,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);
const mockGranted = vi.mocked(grantedResourceIds);

beforeEach(() => {
  vi.clearAllMocks();
  resetRepoMocks(mockRepo);
  mockGranted.mockResolvedValue(new Set<string>());
});

describe("a private base lent by grant", () => {
  it("is attachable by a caller in the granted scope", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_PRIVATE]]);
    mockGranted.mockResolvedValue(new Set([KB_PRIVATE]));
    await createIdentity(ctx(), { name: "R", knowledgeBaseIds: [KB_PRIVATE] });
    expect(mockGranted).toHaveBeenCalledWith(OWNER, "knowledge_base", [KB_PRIVATE]);
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalledWith(
      "ws-1",
      "id-1",
      [{ baseId: KB_PRIVATE, scope: "base" }],
      OWNER
    );
  });

  it("is refused without the grant", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_PRIVATE]]);
    await expect(
      createIdentity(ctx(), { name: "R", knowledgeBaseIds: [KB_PRIVATE] })
    ).rejects.toBeInstanceOf(IdentityKnowledgeBaseNotFoundError);
  });

  it("is refused to a SHARED credential, which is never asked about grants", async () => {
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([BASES[KB_PRIVATE]]);
    mockGranted.mockResolvedValue(new Set([KB_PRIVATE]));
    const shared = ctx({ source: "agent", credentialSubjectUserId: null });
    await expect(
      createIdentity(shared, { name: "R", knowledgeBaseIds: [KB_PRIVATE] })
    ).rejects.toBeInstanceOf(IdentityKnowledgeBaseNotFoundError);
    expect(mockGranted).not.toHaveBeenCalledWith(
      expect.anything(),
      "knowledge_base",
      [KB_PRIVATE]
    );
  });

  it("still passes the teams-mode check: granted, but on no team of the base, is refused", async () => {
    const lentTeams = { ...BASES[KB_PRIVATE], accessMode: "teams" as const };
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([lentTeams]);
    mockGranted.mockResolvedValue(new Set([KB_PRIVATE]));
    mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([
      { knowledgeBaseId: KB_PRIVATE, teamId: TEAM_A },
    ]);
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_B]);
    await expect(
      createIdentity(ctx(), { name: "R", knowledgeBaseIds: [KB_PRIVATE] })
    ).rejects.toBeInstanceOf(IdentityKnowledgeBaseNotFoundError);
    mockRepo.listTeamIdsForUser.mockResolvedValue([TEAM_A]);
    await expect(
      createIdentity(ctx(), { name: "R", knowledgeBaseIds: [KB_PRIVATE] })
    ).resolves.toBeTruthy();
  });
});

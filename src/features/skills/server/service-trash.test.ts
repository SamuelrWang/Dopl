/**
 * INVARIANT SUITE — skills trash aggregation + purge (permanent delete).
 *
 * Through the public service surface with the repository, history writer,
 * and teams repository mocked (no Supabase, no network):
 *   - `listTrashedSkills` normalizes the visible trash to the aggregator
 *     shape { kind:'skill', id, name, deletedAt },
 *   - `purgeSkill` hard-deletes only a soft-deleted skill,
 *   - a LIVE skill is refused (SkillNotTrashedError) — no hard delete,
 *   - an unknown / foreign-workspace id is refused (SkillNotFoundError),
 *   - an AGENT cannot purge a skill flagged agent_write_enabled=false.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Skill, SkillContext } from "../types";

vi.mock("./repository", () => ({
  findSkillById: vi.fn(),
  listDeletedForWorkspace: vi.fn(),
  purgeSkillRow: vi.fn(),
}));

vi.mock("./history", () => ({
  recordVersion: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock("@/features/teams/server/repository", () => ({
  listGrantsForResources: vi.fn().mockResolvedValue([]),
  listTeamIdsForUser: vi.fn().mockResolvedValue([]),
}));

import * as repo from "./repository";
import { listTrashedSkills, purgeSkill } from "./service";
import { SkillAgentWriteDisabledError, SkillNotFoundError, SkillNotTrashedError } from "./errors";

const mockRepo = vi.mocked(repo);

const OWNER = "user-owner";
const TRASHED_AT = "2026-02-01T00:00:00Z";

function ctx(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    workspaceId: "ws-1",
    userId: OWNER,
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    ...overrides,
  };
}

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-x",
    workspaceId: "ws-1",
    slug: "skill-x",
    publicId: "pub-x",
    name: "Skill X",
    description: "desc",
    whenToUse: "when",
    whenNotToUse: null,
    connectors: [],
    status: "active",
    agentWriteEnabled: true,
    visibility: "public",
    accessMode: "workspace",
    folder: null,
    grantedTeamIds: [],
    createdBy: OWNER,
    lastEditedBy: null,
    lastEditedSource: "user",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: TRASHED_AT,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listTrashedSkills", () => {
  it("normalizes visible trashed skills to the aggregator shape", async () => {
    mockRepo.listDeletedForWorkspace.mockResolvedValue({
      skills: [
        skill({ id: "s-1", name: "One", deletedAt: TRASHED_AT }),
        skill({ id: "s-2", name: "Two", deletedAt: "2026-01-15T00:00:00Z" }),
      ],
    });

    const items = await listTrashedSkills(ctx());

    expect(items).toEqual([
      { kind: "skill", id: "s-1", name: "One", deletedAt: TRASHED_AT },
      { kind: "skill", id: "s-2", name: "Two", deletedAt: "2026-01-15T00:00:00Z" },
    ]);
  });
});

describe("purgeSkill", () => {
  it("hard-deletes a trashed skill (workspace-scoped)", async () => {
    mockRepo.findSkillById.mockResolvedValue(skill());

    await purgeSkill(ctx(), "skill-x");

    expect(mockRepo.purgeSkillRow).toHaveBeenCalledWith("ws-1", "skill-x");
  });

  it("refuses a LIVE skill and never hard-deletes", async () => {
    mockRepo.findSkillById.mockResolvedValue(skill({ deletedAt: null }));

    await expect(purgeSkill(ctx(), "skill-x")).rejects.toBeInstanceOf(
      SkillNotTrashedError
    );
    expect(mockRepo.purgeSkillRow).not.toHaveBeenCalled();
  });

  it("refuses an unknown / foreign-workspace id", async () => {
    mockRepo.findSkillById.mockResolvedValue(null);

    await expect(purgeSkill(ctx(), "skill-x")).rejects.toBeInstanceOf(
      SkillNotFoundError
    );
    expect(mockRepo.purgeSkillRow).not.toHaveBeenCalled();
  });

  it("refuses an AGENT purging an agent-read-only skill", async () => {
    mockRepo.findSkillById.mockResolvedValue(skill({ agentWriteEnabled: false }));

    await expect(
      purgeSkill(ctx({ source: "agent" }), "skill-x")
    ).rejects.toBeInstanceOf(SkillAgentWriteDisabledError);
    expect(mockRepo.purgeSkillRow).not.toHaveBeenCalled();
  });
});

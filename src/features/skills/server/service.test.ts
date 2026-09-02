/**
 * Invariant suite — skills visibility (canSeeSkill), CAS write semantics,
 * permanent delete. Through public exports with the repository and history
 * writer mocked: no Supabase, no network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Skill, SkillContext, SkillFile } from "../types";

vi.mock("./repository", () => ({
  listSkillsForWorkspace: vi.fn(),
  findSkillBySlug: vi.fn(),
  findSkillById: vi.fn(),
  readSkillBody: vi.fn(),
  updateSkillBody: vi.fn(),
  updateSkillRow: vi.fn(),
  listSlugsForWorkspace: vi.fn(),
  hardDeleteSkill: vi.fn(),
}));

vi.mock("./history", () => ({
  recordVersion: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock("@/features/teams/server/repository", () => ({
  listGrantsForResources: vi.fn().mockResolvedValue([]),
  listTeamIdsForUser: vi.fn().mockResolvedValue([]),
  deleteGrantsForResource: vi.fn(),
  insertReadGrantsIfMissing: vi.fn(),
}));

import * as repo from "./repository";
import * as history from "./history";
import * as teamsRepo from "@/features/teams/server/repository";
import { deleteSkill, listSkills, updateSkill, writeBody } from "./service";
import { SkillStaleVersionError } from "./errors";

const mockRepo = vi.mocked(repo);
const mockHistory = vi.mocked(history);
const mockTeams = vi.mocked(teamsRepo);

const OWNER = "user-owner";
const OTHER = "user-other";

function ctx(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    workspaceId: "ws-1",
    userId: OWNER,
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: OWNER,
    ...overrides,
  };
}

function skill(overrides: Partial<Skill>): Skill {
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
    deletedAt: null,
    ...overrides,
  };
}

function file(overrides: Partial<SkillFile>): SkillFile {
  return {
    id: "file-x",
    workspaceId: "ws-1",
    skillId: "skill-x",
    name: "SKILL.md",
    body: "old body",
    position: 0,
    createdBy: OWNER,
    lastEditedBy: null,
    lastEditedSource: "user",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "v1",
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTeams.listGrantsForResources.mockResolvedValue([]);
  mockTeams.listTeamIdsForUser.mockResolvedValue([]);
});

// ── canSeeSkill via listSkills ───────────────────────────────────────

describe("listSkills visibility (canSeeSkill)", () => {
  async function visibleSlugs(c: SkillContext, rows: Skill[]): Promise<string[]> {
    mockRepo.listSkillsForWorkspace.mockResolvedValue(rows);
    const visible = await listSkills(c);
    return visible.map((s) => s.slug).sort();
  }

  it("owner sees own private; non-owner does not; public is visible to all", async () => {
    const rows = [
      skill({ id: "s-ownpriv", slug: "own-private", visibility: "private", createdBy: OWNER }),
      skill({ id: "s-otherpriv", slug: "other-private", visibility: "private", createdBy: OTHER }),
      skill({ id: "s-public", slug: "public-one", visibility: "public", accessMode: "workspace", createdBy: OTHER }),
    ];
    expect(await visibleSlugs(ctx({ userId: OWNER }), rows)).toEqual(["own-private", "public-one"]);
    expect(await visibleSlugs(ctx({ userId: "user-third" }), rows)).toEqual(["public-one"]);
  });

  it("workspace-scoped API key sees no private skills (even its own)", async () => {
    const rows = [
      skill({ id: "s-ownpriv", slug: "own-private", visibility: "private", createdBy: OWNER }),
      skill({ id: "s-public", slug: "public-one", visibility: "public", accessMode: "workspace", createdBy: OWNER }),
    ];
    expect(
      await visibleSlugs(
        ctx({ apiKeyWorkspaceId: "ws-1", credentialSubjectUserId: null }),
        rows
      )
    ).toEqual(["public-one"]);
  });

  it("teams-mode skill is invisible without a grant, visible with one", async () => {
    const rows = [
      skill({
        id: "s-team",
        slug: "team-skill",
        visibility: "public",
        accessMode: "teams",
        createdBy: OTHER,
      }),
    ];
    const member = ctx({ userId: "user-member", role: "member" });

    mockTeams.listGrantsForResources.mockResolvedValue([]);
    mockTeams.listTeamIdsForUser.mockResolvedValue([]);
    expect(await visibleSlugs(member, rows)).toEqual([]);

    mockTeams.listGrantsForResources.mockResolvedValue([
      { resourceId: "s-team", teamId: "team-A" } as never,
    ]);
    mockTeams.listTeamIdsForUser.mockResolvedValue(["team-A"] as never);
    expect(await visibleSlugs(member, rows)).toEqual(["team-skill"]);
  });
});

// ── writeBody CAS semantics ──────────────────────────────────────────

describe("writeBody optimistic concurrency", () => {
  beforeEach(() => {
    mockRepo.findSkillBySlug.mockResolvedValue(skill({}));
  });

  it("version mismatch surfaces the conflict and writes no history", async () => {
    mockRepo.readSkillBody.mockResolvedValue(file({ updatedAt: "v1", body: "old body" }));

    await expect(
      writeBody(ctx(), "skill-x", { body: "new body" }, "v0"),
    ).rejects.toBeInstanceOf(SkillStaleVersionError);

    expect(mockRepo.updateSkillBody).not.toHaveBeenCalled();
    expect(mockHistory.recordVersion).not.toHaveBeenCalled();
  });

  it("successful write records one history version and returns the fresh metadata clock", async () => {
    mockRepo.readSkillBody.mockResolvedValue(file({ updatedAt: "v1", body: "old body" }));
    mockRepo.updateSkillBody.mockResolvedValue(file({ id: "file-x", updatedAt: "v2", body: "new body" }));
    // Touch trigger bumped updated_at, so writeBody re-reads the row: body
    // clock (v2) and metadata clock (meta-v2) are distinct.
    mockRepo.findSkillById.mockResolvedValue(skill({ updatedAt: "meta-v2" }));

    const { file: saved, skillUpdatedAt } = await writeBody(
      ctx(),
      "skill-x",
      { body: "new body" },
      "v1"
    );

    expect(saved.updatedAt).toBe("v2");
    expect(skillUpdatedAt).toBe("meta-v2");
    expect(mockRepo.updateSkillBody).toHaveBeenCalledTimes(1);
    expect(mockHistory.recordVersion).toHaveBeenCalledTimes(1);
  });

  it("no-op save returns the unchanged metadata clock without re-reading the row", async () => {
    mockRepo.readSkillBody.mockResolvedValue(file({ updatedAt: "v1", body: "same body" }));

    const { skillUpdatedAt } = await writeBody(ctx(), "skill-x", { body: "same body" }, "v1");

    expect(skillUpdatedAt).toBe("2026-01-01T00:00:00Z");
    expect(mockRepo.findSkillById).not.toHaveBeenCalled();
  });

  it("force (no expected version) skips the precondition but still records history", async () => {
    mockRepo.readSkillBody.mockResolvedValue(file({ updatedAt: "v1", body: "old body" }));
    mockRepo.updateSkillBody.mockResolvedValue(file({ updatedAt: "v2", body: "new body" }));

    await writeBody(ctx(), "skill-x", { body: "new body" }, undefined);

    // expectedUpdatedAt undefined = no DB-level CAS.
    expect(mockRepo.updateSkillBody).toHaveBeenCalledTimes(1);
    expect(mockRepo.updateSkillBody.mock.calls[0][2]).toBeUndefined();
    expect(mockHistory.recordVersion).toHaveBeenCalledTimes(1);
  });

  it("identical-body save is a no-op (no row update, no version)", async () => {
    mockRepo.readSkillBody.mockResolvedValue(file({ updatedAt: "v1", body: "same body" }));

    const { file: returned } = await writeBody(ctx(), "skill-x", { body: "same body" }, "v1");

    expect(returned.updatedAt).toBe("v1");
    expect(mockRepo.updateSkillBody).not.toHaveBeenCalled();
    expect(mockHistory.recordVersion).not.toHaveBeenCalled();
  });

  it("lost CAS race (repo returns null) surfaces the conflict with no history", async () => {
    mockRepo.readSkillBody
      .mockResolvedValueOnce(file({ updatedAt: "v1", body: "old body" }))
      .mockResolvedValueOnce(file({ updatedAt: "v9", body: "raced body" }));
    mockRepo.updateSkillBody.mockResolvedValue(null);

    await expect(
      writeBody(ctx(), "skill-x", { body: "new body" }, "v1"),
    ).rejects.toBeInstanceOf(SkillStaleVersionError);

    expect(mockHistory.recordVersion).not.toHaveBeenCalled();
  });
});

// ── updateSkill metadata CAS ─────────────────────────────────────────

describe("updateSkill metadata optimistic concurrency", () => {
  it("rejects a stale metadata precondition with SkillStaleVersionError", async () => {
    mockRepo.findSkillBySlug.mockResolvedValue(skill({ updatedAt: "v1" }));

    await expect(
      updateSkill(ctx(), "skill-x", { name: "Renamed" }, "v0"),
    ).rejects.toBeInstanceOf(SkillStaleVersionError);

    // A stale precondition must never reach the row write.
    expect(mockRepo.updateSkillRow).not.toHaveBeenCalled();
  });

  it("a matching (or absent) precondition writes the row", async () => {
    mockRepo.findSkillBySlug.mockResolvedValue(skill({ updatedAt: "v1" }));
    mockRepo.updateSkillRow.mockResolvedValue(skill({ name: "Renamed", updatedAt: "v2" }));

    const saved = await updateSkill(ctx(), "skill-x", { name: "Renamed" }, "v1");

    expect(saved.name).toBe("Renamed");
    expect(mockRepo.updateSkillRow).toHaveBeenCalledTimes(1);
    expect(mockRepo.updateSkillRow.mock.calls[0][2]).toBe("v1");
  });
});

// ── deleteSkill — PERMANENT delete ───────────────────────────────────
// Row removed immediately; no restore, no purge, `deleted_at` never written.

describe("deleteSkill — permanent delete", () => {
  it("HARD-deletes the row and writes no tombstone", async () => {
    mockRepo.findSkillBySlug.mockResolvedValue(skill({ id: "s-1" }));

    await deleteSkill(ctx(), "skill-x");

    expect(mockRepo.hardDeleteSkill).toHaveBeenCalledWith("ws-1", "s-1");
  });

  it("records NO history event — skill_events cascades with the row", async () => {
    // `skill_events.skill_id` FKs ON DELETE CASCADE, so an event insert would
    // violate the FK against a row that no longer exists.
    mockRepo.findSkillBySlug.mockResolvedValue(skill({ id: "s-1" }));

    await deleteSkill(ctx(), "skill-x");

    expect(mockHistory.recordEvent).not.toHaveBeenCalled();
  });

  it("refuses an agent on an agent-read-only skill (no delete)", async () => {
    mockRepo.findSkillBySlug.mockResolvedValue(
      skill({ id: "s-1", agentWriteEnabled: false })
    );

    await expect(
      deleteSkill(ctx({ source: "agent" }), "skill-x")
    ).rejects.toThrow();
    expect(mockRepo.hardDeleteSkill).not.toHaveBeenCalled();
  });
});

// ── Narrowing is blocked by nothing ──────────────────────────────────

describe("updateSkill sharing narrowing — nothing blocks it", () => {
  it("narrows a workspace-public skill to private in one write", async () => {
    mockRepo.findSkillBySlug.mockResolvedValue(
      skill({ id: "s-1", visibility: "public", accessMode: "workspace" })
    );
    mockRepo.updateSkillRow.mockResolvedValue(
      skill({ id: "s-1", visibility: "private" })
    );

    const saved = await updateSkill(ctx(), "skill-x", { visibility: "private" });

    expect(saved.visibility).toBe("private");
    expect(mockRepo.updateSkillRow).toHaveBeenCalledTimes(1);
  });
});

/**
 * INVARIANT SUITE — skills visibility (canSeeSkill) + CAS write semantics.
 *
 * Two invariants, both through public exports with the repository (and the
 * history writer) mocked — no Supabase, no network:
 *
 *   (2) canSeeSkill matrix, exercised via `listSkills`: owner sees own
 *       private; non-owner does NOT see someone else's private; public
 *       workspace skills are visible; a workspace-scoped API key sees no
 *       private; a teams-mode skill is invisible without a grant and
 *       visible with one.
 *
 *   (3) writeBody optimistic-concurrency: version mismatch surfaces the
 *       conflict with no history write; a successful write records exactly
 *       one history version; "force" (no expected version) still records
 *       history; an identical-body save is a no-op; a lost CAS race
 *       (repo returns null) surfaces the conflict.
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
  listSkillUsedBy: vi.fn(),
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
import { listSkills, updateSkill, writeBody } from "./service";
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

// ── (2) canSeeSkill via listSkills ───────────────────────────────────

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
    // Owner: sees own private + public, not the other's private.
    expect(await visibleSlugs(ctx({ userId: OWNER }), rows)).toEqual(["own-private", "public-one"]);
    // A different member: sees only public.
    expect(await visibleSlugs(ctx({ userId: "user-third" }), rows)).toEqual(["public-one"]);
  });

  it("workspace-scoped API key sees no private skills (even its own)", async () => {
    const rows = [
      skill({ id: "s-ownpriv", slug: "own-private", visibility: "private", createdBy: OWNER }),
      skill({ id: "s-public", slug: "public-one", visibility: "public", accessMode: "workspace", createdBy: OWNER }),
    ];
    expect(await visibleSlugs(ctx({ apiKeyWorkspaceId: "ws-1" }), rows)).toEqual(["public-one"]);
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

    // No grant → invisible.
    mockTeams.listGrantsForResources.mockResolvedValue([]);
    mockTeams.listTeamIdsForUser.mockResolvedValue([]);
    expect(await visibleSlugs(member, rows)).toEqual([]);

    // Granted to team-A and the member is on team-A → visible.
    mockTeams.listGrantsForResources.mockResolvedValue([
      { resourceId: "s-team", teamId: "team-A" } as never,
    ]);
    mockTeams.listTeamIdsForUser.mockResolvedValue(["team-A"] as never);
    expect(await visibleSlugs(member, rows)).toEqual(["team-skill"]);
  });
});

// ── (3) writeBody CAS semantics ──────────────────────────────────────

describe("writeBody optimistic concurrency", () => {
  beforeEach(() => {
    // getSkillBySlug funnels through findSkillBySlug (non-uuid ref).
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
    // The body write bumped the row's updated_at (touch trigger); writeBody
    // re-reads it so the client can keep its metadata precondition current
    // (F-038 D10). body clock (v2) and metadata clock (meta-v2) are distinct.
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

    // No write happened, so updated_at is unchanged (the pre-read skill's) and
    // no extra findSkillById round-trip is issued.
    expect(skillUpdatedAt).toBe("2026-01-01T00:00:00Z");
    expect(mockRepo.findSkillById).not.toHaveBeenCalled();
  });

  it("force (no expected version) skips the precondition but still records history", async () => {
    mockRepo.readSkillBody.mockResolvedValue(file({ updatedAt: "v1", body: "old body" }));
    mockRepo.updateSkillBody.mockResolvedValue(file({ updatedAt: "v2", body: "new body" }));

    await writeBody(ctx(), "skill-x", { body: "new body" }, undefined);

    // Third arg (expectedUpdatedAt) forwarded as undefined = no DB-level CAS.
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

// ── (4) updateSkill metadata CAS (F-038 D9) ──────────────────────────

describe("updateSkill metadata optimistic concurrency", () => {
  it("rejects a stale metadata precondition with SkillStaleVersionError", async () => {
    mockRepo.findSkillBySlug.mockResolvedValue(skill({ updatedAt: "v1" }));

    await expect(
      updateSkill(ctx(), "skill-x", { name: "Renamed" }, "v0"),
    ).rejects.toBeInstanceOf(SkillStaleVersionError);

    // A stale precondition must never reach the row write (last-write-wins was
    // the D9 bug — the web client now threads this token).
    expect(mockRepo.updateSkillRow).not.toHaveBeenCalled();
  });

  it("a matching (or absent) precondition writes the row", async () => {
    mockRepo.findSkillBySlug.mockResolvedValue(skill({ updatedAt: "v1" }));
    mockRepo.updateSkillRow.mockResolvedValue(skill({ name: "Renamed", updatedAt: "v2" }));

    const saved = await updateSkill(ctx(), "skill-x", { name: "Renamed" }, "v1");

    expect(saved.name).toBe("Renamed");
    expect(mockRepo.updateSkillRow).toHaveBeenCalledTimes(1);
    // The precondition is forwarded to the repo for the atomic CAS re-check.
    expect(mockRepo.updateSkillRow.mock.calls[0][2]).toBe("v1");
  });
});

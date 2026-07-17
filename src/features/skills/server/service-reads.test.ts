/**
 * REGRESSION — the seeded-skill DetailPane "Couldn't load" bug.
 *
 * A freshly-seeded skill has its SKILL.md body on the skill row and ZERO
 * `skill_versions` rows (the seed path inserts no version). This suite
 * pins two facts about `resolveSkillBody` — the exact service fn the
 * `GET /api/skills/[slug]` route calls:
 *
 *   1. A seeded-shape skill (body present, no version history) loads
 *      fully — the detail/DTO path never depends on a version row.
 *
 *   2. The resolve is WORKSPACE-SCOPED: a lookup that lands in the wrong
 *      workspace yields `SkillNotFoundError` (→ 404 → "Couldn't load").
 *      This is precisely what happened when the DetailPane fetched
 *      WITHOUT an X-Workspace-Id header: `withWorkspaceAuth` fell back to
 *      the caller's DEFAULT workspace, the seeded slug wasn't there, and
 *      the pane showed the fallback. The fix threads `workspaceId` into
 *      the client fetch so the route targets the viewed workspace.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Skill, SkillContext, SkillFile } from "../types";

vi.mock("./repository", () => ({
  findSkillBySlug: vi.fn(),
  findSkillById: vi.fn(),
  readSkillBody: vi.fn(),
  knowledgeBaseSlugExists: vi.fn(),
}));

vi.mock("@/features/teams/server/repository", () => ({
  listGrantsForResources: vi.fn().mockResolvedValue([]),
  listTeamIdsForUser: vi.fn().mockResolvedValue([]),
}));

import * as repo from "./repository";
import { resolveSkillBody } from "./service";
import { SkillNotFoundError } from "./errors";

const mockRepo = vi.mocked(repo);

const SEED_SLUG = "archive-a-session-to-chats";
// A seed body carries the canonical KB chip syntax the parser resolves.
const SEED_BODY =
  "Export with `dopl_chats`. See [Dopl Guide](dopl://kb/dopl-guide) for the ritual.";

function ctx(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    workspaceId: "ws-viewed",
    userId: "user-viewer",
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    ...overrides,
  };
}

/** A seeded skill: public/workspace-visible, inserted by the seed path. */
function seededSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-seed",
    workspaceId: "ws-viewed",
    slug: SEED_SLUG,
    publicId: "pub-seed",
    name: "Archive a session to Chats",
    description: "desc",
    whenToUse: "when",
    whenNotToUse: null,
    connectors: [],
    status: "active",
    agentWriteEnabled: false,
    visibility: "public",
    accessMode: "workspace",
    folder: "Dopl",
    grantedTeamIds: [],
    createdBy: "user-creator",
    lastEditedBy: "user-creator",
    lastEditedSource: "user",
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

/** The single SKILL.md synthesized from the body columns. */
function seededFile(overrides: Partial<SkillFile> = {}): SkillFile {
  return {
    id: "skill-seed",
    workspaceId: "ws-viewed",
    skillId: "skill-seed",
    name: "SKILL.md",
    body: SEED_BODY,
    position: 0,
    createdBy: "user-creator",
    lastEditedBy: "user-creator",
    lastEditedSource: "user",
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSkillBody — seeded-shape skill loads (the route's GET path)", () => {
  it("returns the skill + its single SKILL.md with NO version rows required", async () => {
    mockRepo.findSkillBySlug.mockResolvedValue(seededSkill());
    mockRepo.readSkillBody.mockResolvedValue(seededFile());
    mockRepo.knowledgeBaseSlugExists.mockResolvedValue(true);

    const resolved = await resolveSkillBody(ctx(), SEED_SLUG);

    expect(resolved.skill.slug).toBe(SEED_SLUG);
    expect(resolved.files).toHaveLength(1);
    expect(resolved.files[0].name).toBe("SKILL.md");
    expect(resolved.files[0].body).toBe(SEED_BODY);
    // The seed body's `dopl://kb/dopl-guide` chip resolves as an available
    // KB reference — the resolver ran end to end without a version row.
    expect(resolved.references).toEqual([
      expect.objectContaining({ kind: "kb", slug: "dopl-guide", available: true }),
    ]);
    // The detail path never reads history.
    expect(mockRepo.readSkillBody).toHaveBeenCalledWith("ws-viewed", "skill-seed");
  });

  it("404s when the resolve lands in the WRONG workspace (the header-less bug)", async () => {
    // A header-less client fetch made the route resolve the caller's
    // DEFAULT workspace, where the seeded slug does not exist.
    mockRepo.findSkillBySlug.mockResolvedValue(null);

    await expect(
      resolveSkillBody(ctx({ workspaceId: "ws-default-wrong" }), SEED_SLUG),
    ).rejects.toBeInstanceOf(SkillNotFoundError);

    expect(mockRepo.readSkillBody).not.toHaveBeenCalled();
  });
});

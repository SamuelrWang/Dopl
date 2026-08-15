/** The seed's WRITE SHAPE — one statement, not one insert per fixture — and
 *  the slug → id map the ontology seed's skill attributes resolve against. */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");

import * as repo from "./repository";
import { buildSeedSkills, SEED_SKILL_SLUGS } from "./seed";
import type { SkillContext } from "../types";
import { seedWorkspace } from "./service-seed";

const WS = "ws-1";
const USER = "user-1";

const CTX: SkillContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "owner",
  apiKeyWorkspaceId: null,
};

const FIXTURES = buildSeedSkills();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.listSkillsForWorkspace).mockResolvedValue([]);
  vi.mocked(repo.insertSkills).mockImplementation(async (argsList) =>
    argsList.map(
      (args, i) => ({ id: `skill-${i}`, slug: args.slug, name: args.name }) as never
    )
  );
});

describe("skills seed", () => {
  it("writes every starter skill in one statement", async () => {
    await seedWorkspace(CTX);

    expect(repo.insertSkills).toHaveBeenCalledTimes(1);
    expect(repo.insertSkill).not.toHaveBeenCalled();
    expect(vi.mocked(repo.insertSkills).mock.calls[0][0]).toHaveLength(
      FIXTURES.length
    );
  });

  it("keeps the seed-specific column overrides on every row", async () => {
    await seedWorkspace(CTX);

    for (const row of vi.mocked(repo.insertSkills).mock.calls[0][0]) {
      expect(row.workspaceId).toBe(WS);
      expect(row.createdBy).toBe(USER);
      // Starter content: visible to every member, read-only to agents. ⚠ Set
      // explicitly, never inherited from a default.
      expect(row.visibility).toBe("public");
      expect(row.agentWriteEnabled).toBe(false);
      expect(row.source).toBe("user");
    }
  });

  it("maps every seeded slug to its inserted id", async () => {
    const result = await seedWorkspace(CTX);

    expect(result.skillsCreated).toBe(FIXTURES.length);
    for (const slug of Object.values(SEED_SKILL_SLUGS)) {
      expect(result.skillIdBySlug[slug]?.id).toBeTruthy();
    }
    expect(Object.keys(result.skillIdBySlug).sort()).toEqual(
      FIXTURES.map((f) => f.slug).sort()
    );
  });

  it("is a no-op when the workspace already has skills", async () => {
    vi.mocked(repo.listSkillsForWorkspace).mockResolvedValue([{ id: "s" } as never]);

    const result = await seedWorkspace(CTX);

    expect(result).toEqual({ skillsCreated: 0, skillIdBySlug: {} });
    expect(repo.insertSkills).not.toHaveBeenCalled();
  });
});

import "server-only";
import type { SkillContext } from "../types";
import * as repo from "./repository";
import { buildSeedSkills } from "./seed";

export interface SeedSkillsResult {
  skillsCreated: number;
  /** slug → { id, name } for the seeded skills, so the ontology and
   *  workflow seeds can point their skill references at real ids. */
  skillIdBySlug: Record<string, { id: string; name: string }>;
}

export async function seedWorkspace(
  ctx: SkillContext
): Promise<SeedSkillsResult> {
  const existing = await repo.listSkillsForWorkspace(ctx.workspaceId);
  if (existing.length > 0) return { skillsCreated: 0, skillIdBySlug: {} };

  let skillsCreated = 0;
  const skillIdBySlug: Record<string, { id: string; name: string }> = {};
  for (const fixture of buildSeedSkills()) {
    const skill = await repo.insertSkill({
      workspaceId: ctx.workspaceId,
      slug: fixture.slug,
      name: fixture.name,
      description: fixture.description,
      whenToUse: fixture.whenToUse,
      whenNotToUse: fixture.whenNotToUse,
      connectors: fixture.connectors,
      status: fixture.status,
      folder: fixture.folder,
      // Seeded fixtures are starter content — public so every member
      // can see and run them. Owner-explicit `createSkill` defaults
      // to private; only the seed path overrides.
      visibility: "public",
      body: fixture.body,
      createdBy: ctx.userId,
      source: "user",
    });
    skillIdBySlug[fixture.slug] = { id: skill.id, name: skill.name };
    skillsCreated += 1;
  }
  return { skillsCreated, skillIdBySlug };
}

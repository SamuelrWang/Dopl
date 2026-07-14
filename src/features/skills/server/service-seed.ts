import "server-only";
import { PRIMARY_SKILL_FILE_NAME } from "../types";
import type { SkillContext } from "../types";
import * as repo from "./repository";
import { buildSeedSkills } from "./seed";

export async function seedWorkspace(
  ctx: SkillContext
): Promise<{ skillsCreated: number }> {
  const existing = await repo.listSkillsForWorkspace(ctx.workspaceId);
  if (existing.length > 0) return { skillsCreated: 0 };

  let skillsCreated = 0;
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
      // Seeded fixtures are starter content — public so every member
      // can see and run them. Owner-explicit `createSkill` defaults
      // to private; only the seed path overrides.
      visibility: "public",
      createdBy: ctx.userId,
      source: "user",
    });
    await repo.insertFile({
      workspaceId: ctx.workspaceId,
      skillId: skill.id,
      name: PRIMARY_SKILL_FILE_NAME,
      body: fixture.body,
      position: 0,
      createdBy: ctx.userId,
      source: "user",
    });
    skillsCreated += 1;
  }
  return { skillsCreated };
}

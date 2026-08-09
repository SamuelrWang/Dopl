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

  // ONE insert, not one per fixture. This runs inside the post-signup
  // redirect (auth/callback → seedNewWorkspace), where every serial
  // round-trip is latency the user watches.
  const skills = await repo.insertSkills(
    buildSeedSkills().map((fixture) => ({
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
      visibility: "public" as const,
      // Starter skills are onboarding scaffold: read-only to AGENTS (the
      // human owner can still edit them in the web UI), mirroring the seeded
      // "Dopl Guide" knowledge base. Set explicitly so it doesn't depend on
      // the insertSkill default (audit F-10b).
      agentWriteEnabled: false,
      body: fixture.body,
      createdBy: ctx.userId,
      source: "user" as const,
    }))
  );

  const skillIdBySlug: Record<string, { id: string; name: string }> = {};
  for (const skill of skills) {
    skillIdBySlug[skill.slug] = { id: skill.id, name: skill.name };
  }
  return { skillsCreated: skills.length, skillIdBySlug };
}

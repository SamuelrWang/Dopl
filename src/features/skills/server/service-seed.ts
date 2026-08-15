import "server-only";
import type { SkillContext } from "../types";
import * as repo from "./repository";
import { buildSeedSkills } from "./seed";

export interface SeedSkillsResult {
  skillsCreated: number;
  /** slug → { id, name }, so the ontology and later seeds can point their
   *  skill references at real ids. */
  skillIdBySlug: Record<string, { id: string; name: string }>;
}

export async function seedWorkspace(
  ctx: SkillContext
): Promise<SeedSkillsResult> {
  const existing = await repo.listSkillsForWorkspace(ctx.workspaceId);
  if (existing.length > 0) return { skillsCreated: 0, skillIdBySlug: {} };

  // ⚠ ONE insert, not one per fixture: this runs inside the post-signup
  // redirect, where every serial round-trip is latency the user watches.
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
      // Starter content: public so every member can see and run it.
      // `createSkill` defaults private; only the seed path overrides.
      visibility: "public" as const,
      // ⚠ Read-only to AGENTS (humans still edit in the web UI), mirroring
      // the seeded "Dopl Guide" KB. Set EXPLICITLY so it can't ride on the
      // insertSkill default.
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

import "server-only";
import type { Skill, SkillContext } from "../types";
import { SkillNotFoundError } from "./errors";
import * as repo from "./repository";
import * as history from "./history";
import {
  assertAgentWriteAllowed,
  canSeeSkill,
  grantsForSkills,
} from "./service-shared";

/**
 * Visibility-filtered trash listing + restore for skills. The trash
 * applies the same `canSeeSkill` gate the live list uses so it never
 * leaks other members' private (or non-granted team-scoped) skills.
 */

/**
 * Returns the soft-deleted skills the CALLER MAY SEE, sorted
 * newest-deletion-first. Used by the trash modal. The visibility rule
 * is the same `canSeeSkill` the live list uses — without it the trash
 * would leak other members' private (or non-granted team-scoped)
 * skills' names.
 */
export async function listTrash(
  ctx: SkillContext
): Promise<repo.DeletedSkillRows> {
  const deleted = await repo.listDeletedForWorkspace(ctx.workspaceId);
  const grants = await grantsForSkills(ctx, deleted.skills);
  return {
    skills: deleted.skills.filter((s) => canSeeSkill(ctx, s, grants)),
  };
}

/** Restore-path visibility gate — a forged id for a skill the caller
 *  can't see must 404, exactly like the read paths. */
async function assertTrashedSkillVisible(
  ctx: SkillContext,
  skill: Skill
): Promise<void> {
  const grants = await grantsForSkills(ctx, [skill]);
  if (!canSeeSkill(ctx, skill, grants)) throw new SkillNotFoundError(skill.id);
}

export async function restoreSkill(
  ctx: SkillContext,
  id: string
): Promise<Skill> {
  const skill = await repo.findSkillById(ctx.workspaceId, id, true);
  if (!skill) throw new SkillNotFoundError(id);
  await assertTrashedSkillVisible(ctx, skill);
  await assertAgentWriteAllowed(ctx, skill);
  const restored = await repo.restoreSkillRow(id);
  await history.recordEvent({ ctx, skillId: skill.id, type: "skill.restored" });
  return restored;
}

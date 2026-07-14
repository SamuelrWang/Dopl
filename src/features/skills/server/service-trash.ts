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
 * Returns the soft-deleted skill and skill_file rows the CALLER MAY
 * SEE, sorted newest-deletion-first. Used by the trash modal. The
 * visibility rule is the same `canSeeSkill` the live list uses —
 * without it the trash would leak other members' private (or
 * non-granted team-scoped) skills' names.
 */
export async function listTrash(
  ctx: SkillContext
): Promise<repo.DeletedSkillRows> {
  const deleted = await repo.listDeletedForWorkspace(ctx.workspaceId);
  // Trashed files may belong to LIVE parents (file trashed alone), so
  // resolve every parent skill before filtering.
  const parents = new Map(deleted.skills.map((s) => [s.id, s]));
  const missingIds = [
    ...new Set(
      deleted.files
        .map((f) => f.skillId)
        .filter((id) => !parents.has(id))
    ),
  ];
  for (const s of await repo.listSkillsByIds(ctx.workspaceId, missingIds)) {
    parents.set(s.id, s);
  }
  const grants = await grantsForSkills(ctx, [...parents.values()]);
  const canSee = (skillId: string) => {
    const s = parents.get(skillId);
    return s !== undefined && canSeeSkill(ctx, s, grants);
  };
  return {
    skills: deleted.skills.filter((s) => canSee(s.id)),
    files: deleted.files.filter((f) => canSee(f.skillId)),
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

import "server-only";
import type { Skill, SkillContext } from "../types";
import {
  SkillAgentWriteDisabledError,
  SkillNotFoundError,
  SkillNotTrashedError,
} from "./errors";
import * as repo from "./repository";
import * as history from "./history";
import {
  assertAgentWriteAllowed,
  canSeeSkill,
  grantsForSkills,
} from "./service-shared";

/**
 * Visibility-filtered trash listing + restore + purge for skills. The
 * trash applies the same `canSeeSkill` gate the live list uses so it
 * never leaks other members' private (or non-granted team-scoped) skills.
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

/**
 * One trashed skill, normalized for the cross-feature workspace Trash
 * aggregator (Phase 2). `deletedAt` is always set — these rows are
 * soft-deleted. Visibility-filtered via `listTrash`; newest-first.
 */
export interface TrashedSkillItem {
  kind: "skill";
  id: string;
  name: string;
  deletedAt: string;
}

export async function listTrashedSkills(
  ctx: SkillContext
): Promise<TrashedSkillItem[]> {
  const { skills } = await listTrash(ctx);
  return skills.map((s) => ({
    kind: "skill" as const,
    id: s.id,
    name: s.name,
    deletedAt: s.deletedAt as string,
  }));
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
  const restored = await repo.restoreSkillRow(ctx.workspaceId, id);
  await history.recordEvent({ ctx, skillId: skill.id, type: "skill.restored" });
  return restored;
}

/**
 * Permanently hard-delete a single trashed skill. Same gating as
 * `deleteSkill`: the caller must be able to see the skill, an agent may
 * not purge a skill flagged `agent_write_enabled=false`, and the caller
 * needs `edit` access — all enforced by `assertAgentWriteAllowed`. Refuses
 * a LIVE skill (purge only removes soft-deleted rows). skill_versions /
 * events / workflow links cascade via FK.
 */
export async function purgeSkill(
  ctx: SkillContext,
  id: string
): Promise<void> {
  const skill = await repo.findSkillById(ctx.workspaceId, id, true);
  if (!skill) throw new SkillNotFoundError(id);
  await assertTrashedSkillVisible(ctx, skill);
  if (skill.deletedAt === null) throw new SkillNotTrashedError(id);
  await assertAgentWriteAllowed(ctx, skill);
  // F-10: honor the per-skill agent-read-only flag on the destructive path,
  // mirroring `deleteSkill` — an agent must not purge a skill flagged
  // read-only even if the access matrix would otherwise grant 'edit'.
  if (ctx.source === "agent" && !skill.agentWriteEnabled) {
    throw new SkillAgentWriteDisabledError(
      skill.slug,
      "This skill is read-only to agents (agent_write_enabled=false) — delete it from the Dopl web UI."
    );
  }
  // No history event: the purge cascade-deletes this skill's skill_events
  // rows (FK), and inserting one for the now-gone skill_id would violate
  // the FK. The audit trail dies with the skill by design.
  await repo.purgeSkillRow(ctx.workspaceId, id);
}

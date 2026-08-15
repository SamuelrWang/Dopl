import "server-only";
import { PRIMARY_SKILL_FILE_NAME } from "../types";
import type { SkillContext, SkillFile } from "../types";
import { SkillFileNotFoundError, SkillNotFoundError } from "./errors";
import * as repo from "./repository";
import * as history from "./history";
import {
  assertAgentWriteAllowed,
  canSeeSkill,
  grantsForSkills,
} from "./service-shared";
import { getSkillBySlug } from "./service-reads";

/** History reads + version restore. All mutations funnel through the single
 *  `./history` choke-point. */

/** Version metadata + events for the history panel, newest first. */
export async function getSkillHistory(
  ctx: SkillContext,
  slug: string,
  opts: { limit?: number } = {}
) {
  const skill = await getSkillBySlug(ctx, slug);
  return history.listHistory(ctx, skill.id, opts);
}

/** One snapshot with its full body (for the diff view). */
export async function getFileVersion(ctx: SkillContext, versionId: string) {
  const version = await history.findVersionWithBody(ctx, versionId);
  if (!version) {
    throw new SkillFileNotFoundError("(version)", versionId);
  }
  // Visibility rides on the parent skill: no skill, no version.
  const skill = await repo.findSkillById(ctx.workspaceId, version.skillId);
  if (!skill || !canSeeSkill(ctx, skill, await grantsForSkills(ctx, [skill]))) {
    throw new SkillFileNotFoundError("(version)", versionId);
  }
  return version;
}

/** Roll the body back to a snapshot. ⚠ Restore never rewrites history — it
 *  writes the old body as a NEW save, minting a fresh version. No-ops when the
 *  body already matches. No structural event: the version snapshot is the
 *  record. */
export async function restoreFileVersion(
  ctx: SkillContext,
  versionId: string
): Promise<SkillFile> {
  const version = await getFileVersion(ctx, versionId);
  const skill = await repo.findSkillById(ctx.workspaceId, version.skillId);
  if (!skill) throw new SkillNotFoundError(version.skillId);
  await assertAgentWriteAllowed(ctx, skill);
  // readSkillBody excludes trashed skills, so rolling one back 404s.
  const file = await repo.readSkillBody(ctx.workspaceId, skill.id);
  if (!file) throw new SkillFileNotFoundError(skill.slug, PRIMARY_SKILL_FILE_NAME);
  if (file.body === version.body) return file;
  const saved = await repo.updateSkillBody(skill.id, {
    body: version.body,
    editedBy: ctx.userId,
    editedSource: ctx.source,
  });
  await history.recordVersion({
    ctx,
    skillId: skill.id,
    body: saved.body,
  });
  return saved;
}

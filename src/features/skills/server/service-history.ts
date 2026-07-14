import "server-only";
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

/**
 * History reads + version restore (the versions + audit timeline). All
 * mutations funnel through the single `./history` choke-point.
 */

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
  // Visibility check rides on the parent skill: if the caller can't see
  // the skill, the version doesn't exist for them either.
  const skill = await repo.findSkillById(ctx.workspaceId, version.skillId);
  if (!skill || !canSeeSkill(ctx, skill, await grantsForSkills(ctx, [skill]))) {
    throw new SkillFileNotFoundError("(version)", versionId);
  }
  return version;
}

/**
 * Roll a file back to a snapshot. Restore never rewrites history: it
 * writes the old body as a NEW save (minting a fresh version) and logs
 * a `file.rolled_back` event. No-ops when the file already matches.
 */
export async function restoreFileVersion(
  ctx: SkillContext,
  versionId: string
): Promise<SkillFile> {
  const version = await getFileVersion(ctx, versionId);
  const skill = await repo.findSkillById(ctx.workspaceId, version.skillId);
  if (!skill) throw new SkillNotFoundError(version.skillId);
  await assertAgentWriteAllowed(ctx, skill);
  // findFileById excludes trashed files — restoring into a trashed file
  // 404s (restore the file from trash first).
  const file = await repo.findFileById(version.fileId);
  if (!file) throw new SkillFileNotFoundError(skill.slug, version.fileName);
  if (file.body === version.body) return file;
  const saved = await repo.updateFileRow(file.id, {
    body: version.body,
    lastEditedBy: ctx.userId,
    lastEditedSource: ctx.source,
  });
  await history.recordVersion({
    ctx,
    skillId: skill.id,
    fileId: saved.id,
    fileName: saved.name,
    body: saved.body,
  });
  await history.recordEvent({
    ctx,
    skillId: skill.id,
    type: "file.rolled_back",
    fileId: saved.id,
    detail: { versionId, fileName: version.fileName },
  });
  return saved;
}

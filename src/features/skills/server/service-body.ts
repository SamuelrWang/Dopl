import "server-only";
import { PRIMARY_SKILL_FILE_NAME } from "../types";
import type { Skill, SkillContext, SkillFile } from "../types";
import type { SkillFileWriteInput } from "../schema";
import { SkillFileNotFoundError, SkillStaleVersionError } from "./errors";
import * as repo from "./repository";
import * as history from "./history";
import { assertAgentWriteAllowed } from "./service-shared";
import { getSkillBySlug } from "./service-reads";

/**
 * Body read / write for the single SKILL.md. `writeBody` preserves the
 * optimistic-versioning CAS + history snapshotting via the single
 * `./history` choke-point.
 */

/** Fetch the skill's one SKILL.md row (its procedure body + version). */
export async function readBody(
  ctx: SkillContext,
  slug: string
): Promise<SkillFile> {
  const skill = await getSkillBySlug(ctx, slug);
  const file = await repo.findFileByName(skill.id, PRIMARY_SKILL_FILE_NAME);
  if (!file) throw new SkillFileNotFoundError(slug, PRIMARY_SKILL_FILE_NAME);
  return file;
}

/**
 * Overwrite the skill's SKILL.md body (PUT semantics). Preserves the
 * optimistic-versioning CAS + history snapshotting the old per-file
 * `writeFile` had — it now always targets the single primary file.
 */
export async function writeBody(
  ctx: SkillContext,
  slug: string,
  input: SkillFileWriteInput,
  expectedUpdatedAt?: string
): Promise<{ file: SkillFile; skill: Skill }> {
  const skill = await getSkillBySlug(ctx, slug);
  await assertAgentWriteAllowed(ctx, skill);
  const file = await repo.findFileByName(skill.id, PRIMARY_SKILL_FILE_NAME);
  if (!file) throw new SkillFileNotFoundError(slug, PRIMARY_SKILL_FILE_NAME);
  if (expectedUpdatedAt && file.updatedAt !== expectedUpdatedAt) {
    throw new SkillStaleVersionError(expectedUpdatedAt, file.updatedAt);
  }
  // No-op saves (autosave echoes, agent re-writes of identical content)
  // neither touch the row nor mint a version.
  if (input.body === file.body) {
    return { file, skill };
  }
  const saved = await repo.updateFileRow(
    file.id,
    {
      body: input.body,
      lastEditedBy: ctx.userId,
      lastEditedSource: ctx.source,
    },
    expectedUpdatedAt
  );
  // null = atomic CAS lost the race; re-fetch for the actual version.
  if (saved === null) {
    const fresh = await repo.findFileByName(skill.id, PRIMARY_SKILL_FILE_NAME);
    throw new SkillStaleVersionError(
      expectedUpdatedAt!,
      fresh?.updatedAt ?? "concurrent"
    );
  }
  await history.recordVersion({
    ctx,
    skillId: skill.id,
    fileId: saved.id,
    fileName: saved.name,
    body: saved.body,
  });
  return { file: saved, skill };
}

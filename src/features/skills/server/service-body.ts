import "server-only";
import { PRIMARY_SKILL_FILE_NAME } from "../types";
import type { Skill, SkillContext, SkillFile } from "../types";
import type { SkillFileWriteInput } from "../schema";
import { SkillFileNotFoundError, SkillStaleVersionError } from "./errors";
import * as repo from "./repository";
import * as history from "./history";
import { assertAgentWriteAllowed, stripNullBytes } from "./service-shared";
import { getSkillBySlug } from "./service-reads";

/** Body read / write for the single SKILL.md (columns on the skill row).
 *  `writeBody` holds the CAS on `body_updated_at` — surfaced as the version
 *  token — plus history snapshotting via the `./history` choke-point. */

/** Fetch the skill's SKILL.md body + version token. */
export async function readBody(
  ctx: SkillContext,
  slug: string
): Promise<SkillFile> {
  const skill = await getSkillBySlug(ctx, slug);
  const file = await repo.readSkillBody(ctx.workspaceId, skill.id);
  if (!file) throw new SkillFileNotFoundError(slug, PRIMARY_SKILL_FILE_NAME);
  return file;
}

/**
 * Overwrite the SKILL.md body (PUT semantics), with CAS + history snapshot.
 * ⚠ `skillUpdatedAt` is the post-write row `updated_at` — the METADATA CAS
 * clock, which a body write bumps via the touch trigger. Returning it keeps
 * the editor's metadata precondition current; without it the next
 * name/folder/sharing PATCH false-412s. The body's own clock stays
 * `file.updatedAt` (= body_updated_at), which metadata writes never move.
 */
export async function writeBody(
  ctx: SkillContext,
  slug: string,
  input: SkillFileWriteInput,
  expectedUpdatedAt?: string
): Promise<{ file: SkillFile; skill: Skill; skillUpdatedAt: string }> {
  const skill = await getSkillBySlug(ctx, slug);
  await assertAgentWriteAllowed(ctx, skill);
  const file = await repo.readSkillBody(ctx.workspaceId, skill.id);
  if (!file) throw new SkillFileNotFoundError(slug, PRIMARY_SKILL_FILE_NAME);
  if (expectedUpdatedAt && file.updatedAt !== expectedUpdatedAt) {
    throw new SkillStaleVersionError(expectedUpdatedAt, file.updatedAt);
  }
  // ⚠ Strip U+0000 before BOTH the no-op compare and the write, so a
  // NUL-bearing body reconciles against stored content instead of 500-ing.
  const body = stripNullBytes(input.body);
  // No-op saves (autosave echoes, identical agent re-writes) neither touch
  // the row nor mint a version, so updated_at is unchanged.
  if (body === file.body) {
    return { file, skill, skillUpdatedAt: skill.updatedAt };
  }
  const saved = await repo.updateSkillBody(
    skill.id,
    {
      body,
      editedBy: ctx.userId,
      editedSource: ctx.source,
    },
    expectedUpdatedAt
  );
  // null = atomic CAS lost the race; re-fetch for the actual version.
  if (saved === null) {
    const fresh = await repo.readSkillBody(ctx.workspaceId, skill.id);
    throw new SkillStaleVersionError(
      expectedUpdatedAt!,
      fresh?.updatedAt ?? "concurrent"
    );
  }
  await history.recordVersion({
    ctx,
    skillId: skill.id,
    body: saved.body,
  });
  // Re-read the post-write updated_at (metadata clock the touch trigger just
  // bumped). Falls back to the pre-write value only if the row vanished
  // mid-write; a later metadata edit then 412s and reconciles.
  const fresh = await repo.findSkillById(ctx.workspaceId, skill.id);
  return {
    file: saved,
    skill,
    skillUpdatedAt: fresh?.updatedAt ?? skill.updatedAt,
  };
}

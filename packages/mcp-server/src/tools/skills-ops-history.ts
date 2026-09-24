/**
 * `dopl_skill` op="history" and op="restore" — the SKILL.md body's version list, one version
 * read, and the write-back. The app's history panel reads the same routes.
 *
 * ⚠ `history` WITH `revision` IS THE PREVIEW (the old body plus the current Version to pass), so
 * the old/new summary is in hand BEFORE the write. ⚠ `restore` REQUIRES `slug` as well as the
 * version id and refuses a version that belongs to ANOTHER skill — the route is keyed by version
 * alone, and an id copied from the wrong list must not roll back the wrong procedure.
 */

import type { DoplClient, SkillFile } from "@dopl/client";
import { inlineOr, isForeignAuthored } from "./narration";
import { ok, err, isNotFound, type ToolResponse } from "./respond";
import { agentWriteDenied, failureDetail, UNTRUSTED_SKILL_BODY_HEADER } from "./skills-shared";
import { isErr } from "./channel-shared";
import {
  HISTORY_OP,
  HISTORY_PAGE_DEFAULT,
  restoreRefusal,
  revisionNotFound,
  staleBeforeRestore,
} from "./revision-render";
import { refusal } from "./tool-errors";

async function currentBody(client: DoplClient, slug: string): Promise<SkillFile | ToolResponse> {
  try {
    return await client.readSkillBody(slug);
  } catch (e) {
    return err(`Couldn't read SKILL.md from ${inlineOr(slug, "`(empty)`")}: ${failureDetail(e)}`);
  }
}

/** The version, or a named refusal — including a version that belongs to another skill. */
async function versionOf(client: DoplClient, file: SkillFile, versionId: string) {
  try {
    const version = await client.getSkillVersion(versionId);
    if (version.skillId === file.skillId) return version;
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
  return err(
    refusal(
      revisionNotFound(HISTORY_OP),
      `${inlineOr(versionId, "`(empty)`")} is not a version of this skill.`,
    ),
  );
}

export async function opHistory(
  client: DoplClient,
  slug: string,
  callerUserId: string | null,
  opts: { revision?: string; limit?: number },
): Promise<ToolResponse> {
  const file = await currentBody(client, slug);
  if (isErr(file)) return file;
  const current = `Current: Version \`${file.updatedAt}\` · ${file.body.length} chars.`;

  if (opts.revision !== undefined) {
    const version = await versionOf(client, file, opts.revision);
    if (isErr(version)) return version;
    const header = isForeignAuthored({ createdBy: version.authorId, lastEditedBy: null }, callerUserId)
      ? `${UNTRUSTED_SKILL_BODY_HEADER}\n\n`
      : "";
    return ok(
      [
        `${header}# Version \`${version.id}\` of ${inlineOr(slug, "`(empty)`")} / SKILL.md`,
        `Saved ${version.createdAt} via ${version.source} · ${version.body.length} chars.`,
        current,
        `Restoring writes THIS body over the current one as a NEW save; nothing is deleted. To do it: op="restore" slug="${slug}" revision="${version.id}" expected_version="${file.updatedAt}".`,
        "",
        "---",
        "",
        version.body,
      ].join("\n"),
    );
  }

  const history = await client.getSkillHistory(slug, { limit: opts.limit ?? HISTORY_PAGE_DEFAULT });
  const lines = [`# History: ${inlineOr(slug, "`(empty)`")} / SKILL.md`, current, ""];
  if (history.versions.length === 0) lines.push("_No saved versions._");
  for (const v of history.versions) {
    const who = v.authorId && v.authorId === callerUserId ? "you" : "a member";
    lines.push(`- \`${v.id}\` · ${v.createdAt} · by ${who} via ${v.source} · ${v.bodyBytes} bytes`);
  }
  lines.push(
    "",
    history.versions.length >= (opts.limit ?? HISTORY_PAGE_DEFAULT)
      ? `Showing the newest ${history.versions.length}; raise \`limit\` for older ones.`
      : "End of history.",
    `Preview one with op="history" revision="<id>"; restore with op="restore" revision="<id>" expected_version="${file.updatedAt}".`,
  );
  return ok(lines.join("\n"));
}

export async function opRestore(
  client: DoplClient,
  slug: string,
  versionId: string,
  expectedVersion: string,
): Promise<ToolResponse> {
  const file = await currentBody(client, slug);
  if (isErr(file)) return file;
  if (file.updatedAt !== expectedVersion) {
    return staleBeforeRestore('op="read"', file.updatedAt, expectedVersion);
  }
  const version = await versionOf(client, file, versionId);
  if (isErr(version)) return version;
  let saved: SkillFile;
  try {
    saved = await client.restoreSkillVersion(versionId, expectedVersion);
  } catch (e) {
    const mapped = restoreRefusal(e, 'op="read"', HISTORY_OP) ?? agentWriteDenied(e);
    if (mapped) return mapped;
    throw e;
  }
  const unchanged = saved.updatedAt === expectedVersion;
  return ok(
    [
      unchanged
        ? `Nothing to restore: SKILL.md of ${inlineOr(slug, "`(empty)`")} already matches version \`${versionId}\`.`
        : `Restored SKILL.md of ${inlineOr(slug, "`(empty)`")} to version \`${versionId}\` — written as a NEW save; every earlier version is still in op="history".`,
      `Version \`${expectedVersion}\` → \`${saved.updatedAt}\` · ${file.body.length} → ${saved.body.length} chars.`,
    ].join("\n"),
  );
}

/**
 * `dopl_skill` WRITE op handlers. ⚠ Every one can come back 403
 * `SKILL_AGENT_WRITE_DISABLED`, which is why `agentWriteDenied` lives beside
 * `failureDetail` in `skills-shared.ts`.
 */

import type { DoplClient } from "@dopl/client";
import { inlineOr } from "./narration";
import { ok, err, isConflict, type ToolResponse } from "./respond";
import { agentWriteDenied, failureDetail, NO_NAME } from "./skills-shared";

export async function opWrite(
  client: DoplClient,
  slug: string,
  body: string,
  expected_version?: string,
  force?: boolean,
): Promise<ToolResponse> {
  try {
    const { file } = await client.writeSkillBody(
      slug,
      body,
      force ? null : expected_version
    );
    return ok(
      `Wrote SKILL.md in \`${slug}\` (${file.body.length} chars). New version: \`${file.updatedAt}\`.`
    );
  } catch (e) {
    if (isConflict(e)) {
      return err(
        `SKILL.md in \`${slug}\` changed since you last read it. Call dopl_skill(op="read", slug) to get the current body + version, reconcile your changes, then retry write with that expected_version (or pass force=true to overwrite).`
      );
    }
    // Skill flagged read-only to agents — clean message, not a raw code.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    return err(`Couldn't write SKILL.md in \`${slug}\`: ${failureDetail(e)}`);
  }
}

export async function opCreate(
  client: DoplClient,
  params: {
    name?: string;
    description?: string;
    when_to_use?: string;
    when_not_to_use?: string | null;
    slug?: string;
    status?: "active" | "draft";
    agent_write_enabled?: boolean;
    folder?: string | null;
    body?: string;
  },
): Promise<ToolResponse> {
  try {
    const { skill, primaryFile } = await client.createSkill({
      name: params.name as string,
      description: params.description as string,
      whenToUse: params.when_to_use as string,
      whenNotToUse: params.when_not_to_use ?? null,
      slug: params.slug,
      status: params.status,
      agentWriteEnabled: params.agent_write_enabled,
      folder: params.folder ?? null,
      body: params.body,
    });
    const visNote =
      skill.visibility === "private"
        ? "Private to you — only you and your agent can see it."
        : "Visible to the whole workspace.";
    // ⚠ A draft or private skill is invisible to op="list" — say why, or the
    // caller's next listing silently omits what it just made.
    const listNote =
      skill.status !== "active"
        ? ` It is a ${skill.status}, so dopl_skill(op="list") will NOT show it until status="active".`
        : skill.visibility === "private"
          ? ` Other members' op="list" will not show it while it is private.`
          : "";
    return ok(
      `Created skill ${inlineOr(skill.name, NO_NAME)} (slug: \`${skill.slug}\`). ` +
        `Status: ${skill.status}. ${visNote}${listNote} ` +
        `SKILL.md (${primaryFile.body.length} chars) is ready to edit with \`dopl_skill\` op="write".`
    );
  } catch (e) {
    return err(`Couldn't create skill: ${failureDetail(e)}`);
  }
}

export async function opUpdate(
  client: DoplClient,
  params: {
    slug?: string;
    name?: string;
    description?: string;
    when_to_use?: string;
    when_not_to_use?: string | null;
    new_slug?: string;
    status?: "active" | "draft";
    agent_write_enabled?: boolean;
    folder?: string | null;
  },
): Promise<ToolResponse> {
  const slug = params.slug as string;
  // ⚠ `agent_write_enabled` is a HUMAN-controlled per-skill protection flag: an
  // agent flipping it via MCP is silently dropped server-side, so reject loudly
  // rather than reporting a success that did not happen.
  if (params.agent_write_enabled !== undefined) {
    return err(
      "agent_write_enabled can't be changed by an agent — set it from the Dopl web UI."
    );
  }
  try {
    const updated = await client.updateSkill(slug, {
      name: params.name,
      description: params.description,
      whenToUse: params.when_to_use,
      whenNotToUse: params.when_not_to_use,
      slug: params.new_slug,
      status: params.status,
      folder: params.folder,
    });
    return ok(
      `Updated skill ${inlineOr(updated.name, NO_NAME)} (slug: \`${updated.slug}\`). Status: ${updated.status}.` +
        (updated.status !== "active"
          ? ` A non-active skill is not listed by dopl_skill(op="list").`
          : "") +
        (updated.folder ? ` Folder: ${inlineOr(updated.folder, "`(unnamed folder)`")}.` : "")
    );
  } catch (e) {
    // Skill flagged read-only to agents — clean message, not a raw code.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    return err(`Couldn't update skill \`${slug}\`: ${failureDetail(e)}`);
  }
}

export async function opSetVisibility(
  client: DoplClient,
  slug: string,
  visibility: string,
): Promise<ToolResponse> {
  if (visibility !== "public" && visibility !== "private") {
    return err(`set_visibility takes visibility="public" or "private".`);
  }
  try {
    const skill = await client.updateSkill(slug, { visibility });
    return ok(
      visibility === "public"
        ? `Published skill ${inlineOr(skill.name, NO_NAME)} (slug: \`${skill.slug}\`) — now visible workspace-wide.`
        : `Skill ${inlineOr(skill.name, NO_NAME)} (slug: \`${skill.slug}\`) is now private — only its owner can see it, and it drops out of every other member's dopl_skill(op="list").`,
    );
  } catch (e) {
    return err(`Couldn't change sharing on \`${slug}\`: ${failureDetail(e)}`);
  }
}

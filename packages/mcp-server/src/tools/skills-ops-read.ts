/**
 * `dopl_skill` READ op handlers: list (active + caller-visible, grouped by
 * folder), get (resolved detail + reference availability), read (SKILL.md plus
 * its Version token). Non-mutating. Routed from the registrar in `skills.ts`.
 */

import { bySet, callRef, toolName } from "../call-ref.js";
import type { DoplClient } from "@dopl/client";
import { inlineOr, isForeignAuthored } from "./narration";
import { ok, err, isNotFound, type ToolResponse } from "./respond";
import {
  failureDetail,
  NO_NAME,
  skillsScopeNote,
  UNTRUSTED_SKILL_BODY_HEADER,
} from "./skills-shared";

export async function opList(
  client: DoplClient,
  folder?: string,
): Promise<ToolResponse> {
  const skills = await client.listSkills();
  let active = skills.filter((s) => s.status === "active");
  if (folder !== undefined) {
    const want = folder.trim();
    active = active.filter((s) => (s.folder ?? "") === want);
  }
  if (active.length === 0) {
    // ⚠ The EMPTY case is the same overclaim: a member whose colleague owns
    // private skills must not be told the workspace has none. Both branches say
    // whose view this is.
    return ok(
      folder !== undefined
        ? `No active skills visible to you in folder ${inlineOr(folder, "`(unnamed folder)`")}. ${skillsScopeNote()}`
        : `No active skills visible to you in this workspace. Drafts and other members' private or team-scoped skills are not listed, so this is not proof the workspace has none — ${callRef("members.access_matrix")} is the inventory. Create one with ${bySet({ legacy: `\`${toolName("skill.create")}\` ${callRef("skill.create", {}, { form: "op" })}`, granular: callRef("skill.create") })} (requires the workspace to allow agent writes).`
    );
  }
  // Group by folder; unfiled last.
  const byFolder = new Map<string, typeof active>();
  for (const s of active) {
    const key = s.folder ?? "";
    byFolder.set(key, [...(byFolder.get(key) ?? []), s]);
  }
  const folders = [...byFolder.keys()].sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    return a.localeCompare(b);
  });
  const lines = ["## Skills\n"];
  for (const key of folders) {
    lines.push(`### ${key === "" ? "Unfiled" : `📁 ${inlineOr(key, "`(unnamed folder)`")}`}`);
    lines.push("");
    for (const s of byFolder.get(key)!) {
        const visBadge =
        s.visibility === "private"
          ? " _(private)_"
          : s.accessMode === "teams"
            ? " _(team-shared)_"
            : "";
      lines.push(`- \`${s.slug}\` (id: \`${s.id}\`) — ${inlineOr(s.name, NO_NAME)}${visBadge}`);
      lines.push(`  ${inlineOr(s.description, "`(no description)`")}`);
      lines.push(`  **When to use:** ${inlineOr(s.whenToUse, "`(not described)`")}`);
      if (s.whenNotToUse) {
        lines.push(`  **When NOT to use:** ${inlineOr(s.whenNotToUse, "")}`);
      }
    }
    lines.push("");
  }
  lines.push(
    `Showing ${active.length} skill${active.length === 1 ? "" : "s"}: active, and visible to you. ${skillsScopeNote()}`
  );
  lines.push(
    "",
    `Call ${bySet({ legacy: `\`${toolName("skill.get")}\` ${callRef("skill.get", {}, { form: "op" })}`, granular: callRef("skill.get") })} (or ${callRef("skill.read", {}, { form: "op" })}) with a slug to load the SKILL.md procedure for the skill that fits the task.`
  );
  return ok(lines.join("\n"));
}

export async function opGet(
  client: DoplClient,
  slug: string,
  detail?: "summary" | "full",
  // Caller's user id, for the authorship framing only.
  callerUserId: string | null = null
): Promise<ToolResponse> {
  try {
    const { skill, files, references } = await client.getSkill(slug);
    const file = files.find((f) => f.name === "SKILL.md") ?? files[0];
    const body = file?.body ?? "";
    // ⚠ The FILE's authorship, falling back to the skill row's — the BODY is
    // what is framed, so the body's authors decide.
    const foreign = isForeignAuthored(file ?? skill, callerUserId);
    const lines: string[] = [];
    // ⚠ Framing FIRST, ahead of the heading, so it precedes every peer-typed
    // string and not merely the body. Suppressed in `summary` mode, where there
    // is no body to frame.
    if (foreign && detail !== "summary") {
      lines.push(UNTRUSTED_SKILL_BODY_HEADER, "");
    }
    lines.push(`# Skill ${inlineOr(skill.name, NO_NAME)} \`${skill.slug}\``);
    const scope =
      skill.visibility === "private"
        ? "private"
        : skill.accessMode === "teams"
          ? "team-shared"
          : "public";
    lines.push(
      `id: \`${skill.id}\` · status: ${skill.status} · sharing: ${scope} · folder: ${skill.folder ? inlineOr(skill.folder, "`(unnamed folder)`") : "—"} · agent-write ${skill.agentWriteEnabled ? "on" : "off"}`,
    );
    lines.push(
      `last edited by ${skill.lastEditedSource} · updated ${skill.updatedAt}`,
    );
    lines.push(`When to use: ${skill.whenToUse}`);
    if (skill.whenNotToUse) {
      lines.push(`When NOT to use: ${skill.whenNotToUse}`);
    }

    if (references.length > 0) {
      lines.push("");
      lines.push("## References");
      for (const ref of references) {
        const status = ref.available ? "✓" : "✗ (not available)";
        if (ref.kind === "kb") {
          lines.push(
            `- KB \`${ref.slug}\` (${inlineOr(ref.label, "`(unlabelled)`")}) ${status}` +
              (ref.available
                ? ""
                : " — broken ref; the skill mentions this KB but it isn't in the workspace.")
          );
        } else {
          const fieldHint = ref.field ? `.${ref.field}` : "";
          lines.push(
            `- Connector \`${ref.provider}${fieldHint}\` (${inlineOr(ref.label, "`(unlabelled)`")}) ${status}`
          );
        }
      }
      // ⚠ `available` is an EXISTENCE check, NOT an access check:
      // `knowledgeBaseSlugExists` filters on workspace + slug + `deleted_at IS
      // NULL` and consults no visibility, so a ref to another member's PRIVATE
      // base is marked ✓ here and 404s on the read. Saying so is free; the
      // per-ref access check that would fix it is a query per reference.
      lines.push(
        `_✓ means the reference EXISTS in this workspace, not that you can read it: a base private to another member still shows ✓ and then 404s on ${callRef("kb.read_file")}._`
      );
    }

    if (detail === "summary") {
      lines.push("");
      lines.push(
        `_Summary view — SKILL.md is ${body.length.toLocaleString()} chars. Pass detail="full" or use ${callRef("skill.read", {}, { form: "op" })} for the body._`
      );
    } else {
      lines.push("");
      lines.push("## SKILL.md");
      lines.push("");
      lines.push(body);
    }
    return ok(lines.join("\n"));
  } catch (e) {
    if (isNotFound(e)) {
      return err(`No skill \`${slug}\`. List skills with ${callRef("skill.list")}.`);
    }
    return err(`Couldn't load skill \`${slug}\`: ${failureDetail(e)}`);
  }
}

export async function opRead(
  client: DoplClient,
  slug: string,
  // Caller's user id, for the authorship framing only.
  callerUserId: string | null = null,
): Promise<ToolResponse> {
  try {
    const file = await client.readSkillBody(slug);
    // ⚠ `op="read"` is the BARER body surface (no metadata, no references, just
    // the procedure), so it most needs to say WHOSE procedure it is.
    const header = isForeignAuthored(file, callerUserId)
      ? `${UNTRUSTED_SKILL_BODY_HEADER}\n\n`
      : "";
    return ok(
      `${header}# \`${slug}\` / SKILL.md\nVersion: \`${file.updatedAt}\` (pass as expected_version to write)\n\n${file.body}`
    );
  } catch (e) {
    return err(`Couldn't read SKILL.md from \`${slug}\`: ${failureDetail(e)}`);
  }
}

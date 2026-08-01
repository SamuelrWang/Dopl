/**
 * `dopl_skill` READ op handlers: list (active + caller-visible, grouped by
 * folder), get (resolved detail + reference availability), read (SKILL.md plus
 * its Version token). Non-mutating. Routed from the registrar in `skills.ts`.
 */

import type { DoplClient } from "@dopl/client";
import { inlineOr } from "./narration";
import { ok, err, isNotFound, type ToolResponse } from "./respond";
import { failureDetail, NO_NAME, SCOPE_NOTE } from "./skills-shared";

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
    // "No active skills in this workspace yet" was the empty-case form of the
    // same overclaim: a member whose colleague owns six private skills got told
    // the workspace had none. Both branches now say whose view this is.
    return ok(
      folder !== undefined
        ? `No active skills visible to you in folder ${inlineOr(folder, "`(unnamed folder)`")}. ${SCOPE_NOTE}`
        : `No active skills visible to you in this workspace. Drafts and other members' private or team-scoped skills are not listed, so this is not proof the workspace has none — dopl_members(op="access_matrix") is the inventory. Create one with \`dopl_skill\` op="create" (requires the workspace to allow agent writes).`
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
      // Show sharing scope — that's the access signal that matters.
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
    `Showing ${active.length} skill${active.length === 1 ? "" : "s"}: active, and visible to you. ${SCOPE_NOTE}`
  );
  lines.push(
    "",
    "Call `dopl_skill` op=\"get\" (or op=\"read\") with a slug to load the SKILL.md procedure for the skill that fits the task."
  );
  return ok(lines.join("\n"));
}

export async function opGet(
  client: DoplClient,
  slug: string,
  detail?: "summary" | "full"
): Promise<ToolResponse> {
  try {
    const { skill, files, references } = await client.getSkill(slug);
    const body = files.find((f) => f.name === "SKILL.md")?.body ?? files[0]?.body ?? "";
    const lines: string[] = [];
    lines.push(`# Skill ${inlineOr(skill.name, NO_NAME)} \`${skill.slug}\``);
    const scope =
      skill.visibility === "private"
        ? "private"
        : skill.accessMode === "teams"
          ? "team-shared"
          : "workspace-shared";
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
      // `available` is an EXISTENCE check, not an access check:
      // `knowledgeBaseSlugExists` (features/skills/server/repository.ts) filters
      // on workspace + slug + `deleted_at IS NULL` and consults no visibility at
      // all. So a `dopl://kb/<slug>` pointing at another member's PRIVATE base
      // is marked ✓ here and then 404s on the read. Stating that is free; the
      // per-ref access check that would fix it is a query per reference.
      lines.push(
        `_✓ means the reference EXISTS in this workspace, not that you can read it: a base private to another member still shows ✓ and then 404s on dopl_kb(op="read_file")._`
      );
    }

    if (detail === "summary") {
      // Orientation mode: metadata + body size, no body.
      lines.push("");
      lines.push(
        `_Summary view — SKILL.md is ${body.length.toLocaleString()} chars. Pass detail="full" or use op="read" for the body._`
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
      return err(`No skill \`${slug}\`. List skills with dopl_skill(op="list").`);
    }
    return err(`Couldn't load skill \`${slug}\`: ${failureDetail(e)}`);
  }
}

export async function opRead(
  client: DoplClient,
  slug: string,
): Promise<ToolResponse> {
  try {
    const file = await client.readSkillBody(slug);
    return ok(
      `# \`${slug}\` / SKILL.md\nVersion: \`${file.updatedAt}\` (pass as expected_version to write)\n\n${file.body}`
    );
  } catch (e) {
    return err(`Couldn't read SKILL.md from \`${slug}\`: ${failureDetail(e)}`);
  }
}

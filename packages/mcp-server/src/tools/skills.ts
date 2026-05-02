/**
 * MCP tools for the user's skills.
 *
 * Two reads — `skill_list` (cheap discovery), `skill_get` (resolved
 * body + per-reference availability) — plus the full write surface
 * for agent-driven authoring:
 *
 *   skill_create / skill_update / skill_delete
 *   skill_list_files / skill_read_file
 *   skill_create_file / skill_write_file / skill_rename_file / skill_delete_file
 *   skill_authoring_guide   — fetches the framework on demand
 *
 * Writes are gated server-side by the per-skill `agent_write_enabled`
 * toggle. Calls without the toggle 403 with `SKILL_AGENT_WRITE_DISABLED`.
 *
 * Skills are folders of `.md` files; SKILL.md is the canonical
 * procedure entry point.
 */

import { z, type ZodRawShape } from "zod";
import type { DoplClient } from "@dopl/client";
import { SKILL_AUTHORING_GUIDE } from "../prompts/skill-authoring-guide.js";

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type RegisterTool = <S extends ZodRawShape>(
  name: string,
  description: string,
  schema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>
) => void;

function err(message: string): ToolResponse {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function ok(text: string): ToolResponse {
  return { content: [{ type: "text" as const, text }] };
}

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

export function registerSkillTools(
  register: RegisterTool,
  client: DoplClient
): void {
  // ── skill_list ───────────────────────────────────────────────────
  register(
    "skill_list",
    "List the user's skills in the active workspace. Each skill is a folder of `.md` files; the canonical procedure lives in SKILL.md. Returns trigger metadata (name, description, when_to_use, when_not_to_use, status) so you can pick the right skill before loading bodies. Call at every new task boundary.",
    {},
    async () => {
      const skills = await client.listSkills();
      const active = skills.filter((s) => s.status === "active");
      if (active.length === 0) {
        return ok(
          "No active skills in this workspace yet. Create one with `skill_create` (requires the workspace to allow agent writes)."
        );
      }
      const lines = ["## Skills\n"];
      for (const s of active) {
        const lockBadge = s.agentWriteEnabled
          ? " _(agent writes enabled)_"
          : " _(read-only for agents)_";
        lines.push(`### \`${s.slug}\` — ${s.name}${lockBadge}`);
        lines.push(s.description);
        lines.push(`**When to use:** ${s.whenToUse}`);
        if (s.whenNotToUse) {
          lines.push(`**When NOT to use:** ${s.whenNotToUse}`);
        }
        lines.push("");
      }
      lines.push(
        "Call `skill_get` with a slug to load the procedure body for the skill that fits the task."
      );
      return ok(lines.join("\n"));
    }
  );

  // ── skill_get ────────────────────────────────────────────────────
  register(
    "skill_get",
    "Fetch a skill's resolved bundle: every file (SKILL.md + supplementary), reference availability for KBs and connectors, and metadata. Read SKILL.md first as the procedure; consult supplementary files only when SKILL.md tells you to. References to knowledge bases appear as `[label](dopl://kb/<slug>)` — use `kb_read_file` (or `kb_get_tree`) to load that KB's content when you actually need it.",
    {
      slug: z.string().describe("Skill slug from `skill_list`"),
    },
    async ({ slug }) => {
      try {
        const { skill, files, references } = await client.getSkill(slug);
        const lines: string[] = [];
        lines.push(`# ${skill.name} \`${skill.slug}\``);
        lines.push(`Status: ${skill.status}`);
        lines.push(
          `Agent writes: ${skill.agentWriteEnabled ? "enabled" : "DISABLED"}`
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
                `- KB \`${ref.slug}\` (${ref.label}) ${status}` +
                  (ref.available
                    ? ""
                    : " — broken ref; the skill mentions this KB but it isn't in the workspace.")
              );
            } else {
              const fieldHint = ref.field ? `.${ref.field}` : "";
              lines.push(
                `- Connector \`${ref.provider}${fieldHint}\` (${ref.label}) ${status}`
              );
            }
          }
        }

        for (const file of files) {
          lines.push("");
          lines.push(`## \`${file.name}\``);
          lines.push("");
          lines.push(file.body);
        }
        return ok(lines.join("\n"));
      } catch (e) {
        return err(`Skill not found or failed to load: ${slug}. ${errorMessage(e)}`);
      }
    }
  );

  // ── skill_create ─────────────────────────────────────────────────
  register(
    "skill_create",
    "Create a new skill. Returns the skill row + a freshly created SKILL.md primary file. Required: name, description, when_to_use. Optional: when_not_to_use, slug (auto-derived), status (defaults to active), agent_write_enabled (defaults to false), body (initial SKILL.md content). Before calling: read `skill_authoring_guide` so the description and when_to_use are written to the framework's standards.",
    {
      name: z.string().min(1).max(120),
      description: z.string().min(1).max(2000),
      when_to_use: z.string().min(1).max(2000),
      when_not_to_use: z.string().max(2000).optional(),
      slug: z.string().min(1).max(80).optional(),
      status: z.enum(["active", "draft"]).optional(),
      agent_write_enabled: z.boolean().optional(),
      body: z.string().max(1_048_576).optional(),
    },
    async ({
      name,
      description,
      when_to_use,
      when_not_to_use,
      slug,
      status,
      agent_write_enabled,
      body,
    }) => {
      try {
        const { skill, primaryFile } = await client.createSkill({
          name,
          description,
          whenToUse: when_to_use,
          whenNotToUse: when_not_to_use ?? null,
          slug,
          status,
          agentWriteEnabled: agent_write_enabled,
          body,
        });
        return ok(
          `Created skill **${skill.name}** (slug: \`${skill.slug}\`). ` +
            `Status: ${skill.status}. Agent writes: ${
              skill.agentWriteEnabled ? "enabled" : "disabled"
            }. ` +
            `SKILL.md (${primaryFile.body.length} chars) is ready to edit with \`skill_write_file\`.`
        );
      } catch (e) {
        return err(`Couldn't create skill: ${errorMessage(e)}`);
      }
    }
  );

  // ── skill_update ─────────────────────────────────────────────────
  register(
    "skill_update",
    "Update skill metadata: name, description, when_to_use, when_not_to_use, slug, status, agent_write_enabled. Agents cannot flip `agent_write_enabled` themselves — that's a session-only setting.",
    {
      slug: z.string(),
      name: z.string().min(1).max(120).optional(),
      description: z.string().min(1).max(2000).optional(),
      when_to_use: z.string().min(1).max(2000).optional(),
      when_not_to_use: z.string().max(2000).nullable().optional(),
      new_slug: z.string().min(1).max(80).optional(),
      status: z.enum(["active", "draft"]).optional(),
      agent_write_enabled: z.boolean().optional(),
    },
    async ({
      slug,
      name,
      description,
      when_to_use,
      when_not_to_use,
      new_slug,
      status,
      agent_write_enabled,
    }) => {
      try {
        const updated = await client.updateSkill(slug, {
          name,
          description,
          whenToUse: when_to_use,
          whenNotToUse: when_not_to_use,
          slug: new_slug,
          status,
          agentWriteEnabled: agent_write_enabled,
        });
        return ok(
          `Updated skill **${updated.name}** (slug: \`${updated.slug}\`). Status: ${updated.status}.`
        );
      } catch (e) {
        return err(`Couldn't update skill \`${slug}\`: ${errorMessage(e)}`);
      }
    }
  );

  // ── skill_delete ─────────────────────────────────────────────────
  register(
    "skill_delete",
    "Soft-delete a skill. The skill and its files become invisible. Confirm with the user before calling — this is destructive.",
    { slug: z.string() },
    async ({ slug }) => {
      try {
        await client.deleteSkill(slug);
        return ok(`Deleted skill \`${slug}\`.`);
      } catch (e) {
        return err(`Couldn't delete skill \`${slug}\`: ${errorMessage(e)}`);
      }
    }
  );

  // ── skill_list_files ─────────────────────────────────────────────
  register(
    "skill_list_files",
    "List the files inside a skill. Returns name + position + length for each. Use `skill_read_file` for a specific file's body.",
    { slug: z.string() },
    async ({ slug }) => {
      try {
        const files = await client.listSkillFiles(slug);
        if (files.length === 0) return ok(`Skill \`${slug}\` has no files.`);
        const lines = [`## \`${slug}\` files\n`];
        for (const f of files) {
          lines.push(
            `- **\`${f.name}\`** · ${f.body.length} chars · pos ${f.position}`
          );
        }
        return ok(lines.join("\n"));
      } catch (e) {
        return err(`Couldn't list files for \`${slug}\`: ${errorMessage(e)}`);
      }
    }
  );

  // ── skill_read_file ──────────────────────────────────────────────
  register(
    "skill_read_file",
    "Read one file from a skill. SKILL.md is the canonical procedure entry point; supplementary files (e.g. `examples.md`, `references/*.md`) are referenced from SKILL.md and loaded on demand.",
    {
      slug: z.string(),
      file_name: z.string().describe("e.g. SKILL.md or examples.md"),
    },
    async ({ slug, file_name }) => {
      try {
        const file = await client.readSkillFile(slug, file_name);
        return ok(`# \`${slug}\` / \`${file.name}\`\n\n${file.body}`);
      } catch (e) {
        return err(
          `Couldn't read \`${file_name}\` from \`${slug}\`: ${errorMessage(e)}`
        );
      }
    }
  );

  // ── skill_create_file ────────────────────────────────────────────
  register(
    "skill_create_file",
    "Create a new file in a skill. Use for supplementary content that SKILL.md links to: `examples.md`, `references/<topic>.md`, `templates/<name>.md`. Cannot be used to recreate SKILL.md (it's created by `skill_create`). File names must match `[A-Za-z0-9._-]+\\.md` (no slashes — flat namespace).",
    {
      slug: z.string(),
      file_name: z.string(),
      body: z.string().max(1_048_576).optional(),
    },
    async ({ slug, file_name, body }) => {
      try {
        const file = await client.createSkillFile(slug, {
          name: file_name,
          body,
        });
        return ok(
          `Created \`${file.name}\` in \`${slug}\` (${file.body.length} chars).`
        );
      } catch (e) {
        return err(
          `Couldn't create \`${file_name}\` in \`${slug}\`: ${errorMessage(e)}`
        );
      }
    }
  );

  // ── skill_write_file ─────────────────────────────────────────────
  register(
    "skill_write_file",
    "Overwrite a skill file's body (PUT semantics). Use for editing SKILL.md or any supplementary file. The whole body is replaced — load the current body with `skill_read_file` first if you want to make a partial edit.",
    {
      slug: z.string(),
      file_name: z.string(),
      body: z.string().max(1_048_576),
    },
    async ({ slug, file_name, body }) => {
      try {
        const file = await client.writeSkillFile(slug, file_name, body);
        return ok(
          `Wrote \`${file.name}\` in \`${slug}\` (${file.body.length} chars).`
        );
      } catch (e) {
        return err(
          `Couldn't write \`${file_name}\` in \`${slug}\`: ${errorMessage(e)}`
        );
      }
    }
  );

  // ── skill_rename_file ────────────────────────────────────────────
  register(
    "skill_rename_file",
    "Rename a file inside a skill. Cannot rename SKILL.md.",
    {
      slug: z.string(),
      file_name: z.string(),
      new_name: z.string(),
    },
    async ({ slug, file_name, new_name }) => {
      try {
        const file = await client.renameSkillFile(slug, file_name, new_name);
        return ok(
          `Renamed \`${file_name}\` → \`${file.name}\` in \`${slug}\`.`
        );
      } catch (e) {
        return err(
          `Couldn't rename \`${file_name}\` in \`${slug}\`: ${errorMessage(e)}`
        );
      }
    }
  );

  // ── skill_delete_file ────────────────────────────────────────────
  register(
    "skill_delete_file",
    "Soft-delete a file from a skill. Cannot delete SKILL.md (every skill must keep its primary file).",
    {
      slug: z.string(),
      file_name: z.string(),
    },
    async ({ slug, file_name }) => {
      try {
        await client.deleteSkillFile(slug, file_name);
        return ok(`Deleted \`${file_name}\` from \`${slug}\`.`);
      } catch (e) {
        return err(
          `Couldn't delete \`${file_name}\` from \`${slug}\`: ${errorMessage(e)}`
        );
      }
    }
  );

  // ── skill_authoring_guide ────────────────────────────────────────
  register(
    "skill_authoring_guide",
    "Fetch the canonical skill-authoring framework — what makes a high-quality skill, how to write the description and when_to_use fields, the canonical body section order, anti-patterns, and a quality checklist. Call this before authoring any new skill (every `skill_create` call). The framework is also loaded into the system prompt at session start; this tool is the explicit affordance to re-read it deliberately when you're about to write.",
    {},
    async () => ok(SKILL_AUTHORING_GUIDE)
  );
}

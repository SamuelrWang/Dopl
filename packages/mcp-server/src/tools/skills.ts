/**
 * MCP tools for the user's skills.
 *
 * A skill is SINGLE-FILE: one tight markdown procedure (its SKILL.md)
 * plus metadata. Long reference material belongs in knowledge bases
 * (linked via `dopl://kb/<slug>`), not in the skill. Writes are gated
 * server-side by the per-skill `agent_write_enabled` toggle; calls
 * without it 403 with `SKILL_AGENT_WRITE_DISABLED`.
 *
 * Consolidated into two `op`-dispatched tools (the canonical pattern from
 * `setups.ts`):
 *   - `dopl_skill`       — reads + non-destructive writes.
 *   - `dopl_skill_admin` — DESTRUCTIVE deletes, split out on purpose.
 */

import { z } from "zod";
import type { DoplClient } from "@dopl/client";
import { ok, err, isConflict, isNotFound, missingParams, type RegisterTool, type ToolResponse } from "./respond";
import { SKILL_AUTHORING_GUIDE } from "../prompts/skill-authoring-guide.js";

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

/**
 * Clean surface for the F-10 read-only-skill delete rejection. The API
 * returns 403 `SKILL_AGENT_WRITE_DISABLED` when an agent tries to delete a
 * skill flagged `agent_write_enabled=false`. Surface the server's
 * actionable message verbatim instead of a raw `CODE: message` dump.
 * Returns null otherwise so the caller falls through. Duck-typed on
 * `.status` / `.code` to avoid importing the @dopl/client error class.
 */
function agentWriteDenied(e: unknown): ToolResponse | null {
  if (
    typeof e !== "object" ||
    e === null ||
    (e as { status?: number }).status !== 403 ||
    (e as { code?: unknown }).code !== "SKILL_AGENT_WRITE_DISABLED"
  ) {
    return null;
  }
  const msg = (e as { apiMessage?: unknown }).apiMessage;
  return err(
    typeof msg === "string" && msg
      ? msg
      : "This skill is read-only to agents — delete it from the Dopl web UI."
  );
}

const SKILL_DESCRIPTION = `Read and author the user's skills. A skill is SINGLE-FILE: one tight, self-contained procedure (its SKILL.md) plus metadata — NOT a folder of files. Long reference material (specs, tables, examples) belongs in a knowledge base, linked from the body as \`[label](dopl://kb/<slug>)\`; the skill stays short. Prefer MANY SMALL skills — one action each — over monoliths: small skills attach cleanly to ontology objects and workflow actions. Organize them with the \`folder\` label. Set \`op\` to one of:
- "list" — list the user's active skills in the active workspace with trigger metadata (name, description, when_to_use, when_not_to_use, status), grouped by folder. Call at every new task boundary. Optional: folder (filter to one folder).
- "get" — fetch a skill's resolved detail: the SKILL.md body, reference availability for KBs and connectors, and metadata. KB references appear as \`[label](dopl://kb/<slug>)\` — use \`dopl_kb(op='read_file')\` / \`dopl_kb(op='get_tree')\` to load that KB when you actually need it. Requires: slug. Optional: detail ("summary" = metadata + body length only; "full" (default) = includes the body).
- "read" — read the skill's SKILL.md body plus its Version token (pass that as expected_version to write). Requires: slug.
- "write" — overwrite the skill's SKILL.md body (PUT semantics — the whole body is replaced). read it first to get the Version token and pass it as \`expected_version\` — REQUIRED when a body already exists (412 without it), so a concurrent edit can't be silently overwritten. \`force=true\` skips the check. Requires: slug, body.
- "create" — create a new skill (returns the row + a fresh SKILL.md). New skills default to private. Requires: name, description, when_to_use. Optional: when_not_to_use, slug (auto-derived), status (defaults active), folder, body (initial SKILL.md content). Before calling: use op="authoring_guide" so the description and when_to_use meet the framework's standards.
- "update" — update skill metadata (name, description, when_to_use, when_not_to_use, new_slug, status, folder). \`agent_write_enabled\` is a human-only protection toggle — an agent that passes it here is rejected; change it from the Dopl web UI. Requires: slug.
- "set_visibility" — change a skill's sharing: "public" (workspace-visible) or "private" (owner-only). Owner or workspace-admin only. Team-scoped sharing is web-UI-managed; a team-scoped skill set here to "public" becomes workspace-wide. Requires: slug, visibility.
- "authoring_guide" — fetch the canonical skill-authoring framework: what makes a high-quality single-file skill, how to write description + when_to_use, the body section order, anti-patterns, and a quality checklist. Call before authoring any new skill (every op="create").

Destructive deletes live in the separate \`dopl_skill_admin\` tool.`;

const SKILL_ADMIN_DESCRIPTION = `DESTRUCTIVE skill operations — separated from \`dopl_skill\` on purpose. Confirm with the user before calling. Set \`op\` to one of:
- "delete" — soft-delete an entire skill. The skill becomes invisible (restorable from the web trash). Requires: slug.`;

export function registerSkillTools(
  register: RegisterTool,
  client: DoplClient,
): void {
  register(
    "dopl_skill",
    SKILL_DESCRIPTION,
    {
      op: z
        .enum([
          "list",
          "get",
          "read",
          "write",
          "create",
          "update",
          "set_visibility",
          "authoring_guide",
        ])
        .describe("Operation to perform."),
      slug: z
        .string()
        .optional()
        .describe("Skill slug OR stable id (the uuid from list/get output — survives renames, prefer it for held references). Required for get, read, write, update, set_visibility."),
      name: z.string().min(1).max(120).optional().describe("op=create (required) / op=update: skill name."),
      description: z.string().min(1).max(2000).optional().describe("op=create (required) / op=update: skill description."),
      when_to_use: z.string().min(1).max(2000).optional().describe("op=create (required) / op=update: when_to_use trigger."),
      when_not_to_use: z.string().max(2000).nullable().optional().describe("op=create / op=update: when_not_to_use trigger."),
      new_slug: z.string().min(1).max(80).optional().describe("op=update: rename the skill's slug."),
      status: z.enum(["active", "draft"]).optional().describe("op=create / op=update: skill status (create defaults to active)."),
      agent_write_enabled: z.boolean().optional().describe("op=create: initial agent-write toggle. On op=update an agent passing this is rejected — it's a human-only protection setting (change it from the Dopl web UI)."),
      folder: z.string().max(80).nullable().optional().describe("op=create / op=update: organizing folder label (empty or null = unfiled). op=list: filter to skills in this folder."),
      body: z.string().max(1_048_576).optional().describe("op=create: initial SKILL.md content. op=write (required): the new full SKILL.md body."),
      expected_version: z.string().optional().describe("op=write: the Version from a prior read. Required when overwriting an existing body — omitting it fails with 412; only force=true skips the check."),
      force: z.boolean().optional().describe("op=write: overwrite even if the body changed since you read it. Discards the other edit — use only when intentional."),
      visibility: z.enum(["public", "private"]).optional().describe("op=set_visibility: 'public' shares the skill workspace-wide (referenceable in workflows); 'private' makes it owner-only again. Owner or workspace-admin only. Team-scoped sharing is web-UI-managed."),
      detail: z.enum(["summary", "full"]).optional().describe("op=get: 'summary' returns metadata + body length WITHOUT the body (cheap orientation); 'full' (default) includes the SKILL.md body."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "list":
          return opList(client, args.folder ?? undefined);
        case "get": {
          const miss = missingParams("get", args, ["slug"]);
          if (miss) return miss;
          return opGet(client, args.slug as string, args.detail);
        }
        case "read": {
          const miss = missingParams("read", args, ["slug"]);
          if (miss) return miss;
          return opRead(client, args.slug as string);
        }
        case "write": {
          const miss = missingParams("write", args, ["slug", "body"]);
          if (miss) return miss;
          return opWrite(
            client,
            args.slug as string,
            args.body as string,
            args.expected_version,
            args.force,
          );
        }
        case "create": {
          const miss = missingParams("create", args, ["name", "description", "when_to_use"]);
          if (miss) return miss;
          return opCreate(client, args);
        }
        case "update": {
          const miss = missingParams("update", args, ["slug"]);
          if (miss) return miss;
          return opUpdate(client, args);
        }
        case "set_visibility": {
          const miss = missingParams("set_visibility", args, ["slug", "visibility"]);
          if (miss) return miss;
          return opSetVisibility(client, args.slug as string, args.visibility as string);
        }
        case "authoring_guide":
          return ok(SKILL_AUTHORING_GUIDE);
      }
    },
  );

  register(
    "dopl_skill_admin",
    SKILL_ADMIN_DESCRIPTION,
    {
      op: z.enum(["delete"]).describe("DESTRUCTIVE operation to perform."),
      slug: z.string().optional().describe("Skill slug. Required for delete."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "delete": {
          const miss = missingParams("delete", args, ["slug"]);
          if (miss) return miss;
          return opDelete(client, args.slug as string);
        }
      }
    },
  );
}

async function opList(
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
    return ok(
      folder !== undefined
        ? `No active skills in folder "${folder}".`
        : "No active skills in this workspace yet. Create one with `dopl_skill` op=\"create\" (requires the workspace to allow agent writes)."
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
    lines.push(`### ${key === "" ? "Unfiled" : `📁 ${key}`}`);
    lines.push("");
    for (const s of byFolder.get(key)!) {
      // Show sharing scope — that's the access signal that matters.
      const visBadge =
        s.visibility === "private"
          ? " _(private)_"
          : s.accessMode === "teams"
            ? " _(team-shared)_"
            : "";
      lines.push(`- \`${s.slug}\` (id: \`${s.id}\`) — ${s.name}${visBadge}`);
      lines.push(`  ${s.description}`);
      lines.push(`  **When to use:** ${s.whenToUse}`);
      if (s.whenNotToUse) {
        lines.push(`  **When NOT to use:** ${s.whenNotToUse}`);
      }
    }
    lines.push("");
  }
  lines.push(
    "Call `dopl_skill` op=\"get\" (or op=\"read\") with a slug to load the SKILL.md procedure for the skill that fits the task."
  );
  return ok(lines.join("\n"));
}

async function opGet(
  client: DoplClient,
  slug: string,
  detail?: "summary" | "full"
): Promise<ToolResponse> {
  try {
    const { skill, files, references } = await client.getSkill(slug);
    const body = files.find((f) => f.name === "SKILL.md")?.body ?? files[0]?.body ?? "";
    const lines: string[] = [];
    lines.push(`# ${skill.name} \`${skill.slug}\``);
    const scope =
      skill.visibility === "private"
        ? "private"
        : skill.accessMode === "teams"
          ? "team-shared"
          : "workspace-shared";
    lines.push(
      `id: \`${skill.id}\` · status: ${skill.status} · sharing: ${scope} · folder: ${skill.folder ?? "—"} · agent-write ${skill.agentWriteEnabled ? "on" : "off"}`,
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
    return err(`Couldn't load skill \`${slug}\`: ${errorMessage(e)}`);
  }
}

async function opRead(
  client: DoplClient,
  slug: string,
): Promise<ToolResponse> {
  try {
    const file = await client.readSkillBody(slug);
    return ok(
      `# \`${slug}\` / SKILL.md\nVersion: \`${file.updatedAt}\` (pass as expected_version to write)\n\n${file.body}`
    );
  } catch (e) {
    return err(`Couldn't read SKILL.md from \`${slug}\`: ${errorMessage(e)}`);
  }
}

async function opWrite(
  client: DoplClient,
  slug: string,
  body: string,
  expected_version?: string,
  force?: boolean,
): Promise<ToolResponse> {
  try {
    const { file, webUrl } = await client.writeSkillBody(
      slug,
      body,
      force ? null : expected_version
    );
    return ok(
      `Wrote SKILL.md in \`${slug}\` (${file.body.length} chars). New version: \`${file.updatedAt}\`.\nView in Dopl: ${webUrl}`
    );
  } catch (e) {
    if (isConflict(e)) {
      return err(
        `SKILL.md in \`${slug}\` changed since you last read it. Call dopl_skill(op="read", slug) to get the current body + version, reconcile your changes, then retry write with that expected_version (or pass force=true to overwrite).`
      );
    }
    // F-10b: skill flagged read-only to agents — clean message, not a raw code.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    return err(`Couldn't write SKILL.md in \`${slug}\`: ${errorMessage(e)}`);
  }
}

async function opCreate(
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
    return ok(
      `Created skill **${skill.name}** (slug: \`${skill.slug}\`). ` +
        `Status: ${skill.status}. ${visNote} ` +
        `SKILL.md (${primaryFile.body.length} chars) is ready to edit with \`dopl_skill\` op="write".`
    );
  } catch (e) {
    return err(`Couldn't create skill: ${errorMessage(e)}`);
  }
}

async function opUpdate(
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
  // `agent_write_enabled` is a human-controlled per-skill protection flag.
  // An agent flipping it via MCP used to be silently dropped while the tool
  // still reported success (F-14) — reject loudly instead of swallowing it.
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
      `Updated skill **${updated.name}** (slug: \`${updated.slug}\`). Status: ${updated.status}.` +
        (updated.folder ? ` Folder: ${updated.folder}.` : "")
    );
  } catch (e) {
    // F-10b: skill flagged read-only to agents — clean message, not a raw code.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    return err(`Couldn't update skill \`${slug}\`: ${errorMessage(e)}`);
  }
}

async function opSetVisibility(
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
        ? `Published skill **${skill.name}** (slug: \`${skill.slug}\`) — now visible workspace-wide and referenceable in workflows.`
        : `Skill **${skill.name}** (slug: \`${skill.slug}\`) is now private — only its owner can see it.`,
    );
  } catch (e) {
    return err(`Couldn't change sharing on \`${slug}\`: ${errorMessage(e)}`);
  }
}

async function opDelete(client: DoplClient, slug: string): Promise<ToolResponse> {
  try {
    await client.deleteSkill(slug);
    return ok(`Deleted skill \`${slug}\`.`);
  } catch (e) {
    // F-10: a skill flagged read-only to agents rejects agent deletes.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    return err(`Couldn't delete skill \`${slug}\`: ${errorMessage(e)}`);
  }
}

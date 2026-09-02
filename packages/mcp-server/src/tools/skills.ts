/**
 * MCP tools for the user's skills. A skill is SINGLE-FILE: one tight markdown
 * procedure (SKILL.md) plus metadata; long reference material belongs in
 * knowledge bases (`dopl://kb/<slug>`). ⚠ Writes are gated server-side by the
 * per-skill `agent_write_enabled` toggle — without it, 403
 * `SKILL_AGENT_WRITE_DISABLED`.
 *
 *   - `dopl_skill`       — reads + non-destructive writes.
 *   - `dopl_skill_admin` — ⚠ the delete surface, REFUSING; the ops stay listed
 *                          to teach the refusal.
 *
 * Thin registrar: two descriptions + schemas + op routing, delegating to
 * `skills-shared.ts`, `skills-ops-read.ts`, `skills-ops-write.ts`. ⚠ The
 * `skills-` prefix is what the parity split-scan groups on.
 */

import { z } from "zod";
import type { DoplClient } from "@dopl/client";
import { deleteAdminDescription } from "../delete-policy.js";
import { UNKNOWN_CALLER, type CallerIdentity } from "./identity";
import { ok, missingParams, type RegisterTool, type ToolResponse } from "./respond";
import { SKILL_AUTHORING_GUIDE } from "../prompts/skill-authoring-guide.js";
import { opGet, opList, opRead } from "./skills-ops-read";
import {
  opCreate,
  opDelete,
  opSetVisibility,
  opUpdate,
  opWrite,
} from "./skills-ops-write";

const SKILL_DESCRIPTION = `Read and author the user's skills. A skill is SINGLE-FILE: one tight, self-contained procedure (its SKILL.md) plus metadata; long reference material belongs in a knowledge base, linked as \`[label](dopl://kb/<slug>)\`. Set \`op\` to one of:
- "list" — the ACTIVE skills visible to you, with trigger metadata, grouped by folder. Two silent filters: drafts are absent (your own included), and skills private to another member or scoped to a team you have no grant on are already dropped. A view, not the skill inventory — dopl_members(op="access_matrix") is that. Call at every task boundary. Optional: folder.
- "get" — a skill's resolved detail: SKILL.md body, reference availability, metadata. Requires: slug. Optional: detail ("summary" = metadata + body length; "full" (default) adds the body).
- "read" — the SKILL.md body plus the Version token write wants. Requires: slug.
- "write" — replace the whole SKILL.md body. Requires: slug, body. \`expected_version\` from a prior read is REQUIRED when a body exists — 412 without it, only \`force=true\` skips it.
- "create" — Requires: name, description, when_to_use. Optional: when_not_to_use, slug, status, folder, body. Call op="authoring_guide" first.
- "update" — skill metadata. Requires: slug. \`agent_write_enabled\` is human-only; an agent passing it here is rejected.
- "set_visibility" — "public" (workspace-visible) or "private" (owner-only); owner or workspace-admin only. Requires: slug, visibility.
- "authoring_guide" — the canonical skill-authoring framework. Call before every op="create".

Deleting is app-only: \`dopl_skill_admin\` refuses the op it lists.`;

const SKILL_ADMIN_DESCRIPTION = deleteAdminDescription(
  [{ op: "delete", effect: "would have deleted a skill" }],
  `Reach for instead: \`dopl_skill\` op=write to replace the SKILL.md body, or op=update with status="draft" to take a skill out of the list an agent sees without destroying it. If it genuinely has to go, ask the user to delete it in the Dopl app.`,
);

export function registerSkillTools(
  register: RegisterTool,
  client: DoplClient,
  // ⚠ Read for exactly ONE thing: whether a SKILL.md is somebody else's, which
  // decides `UNTRUSTED_SKILL_BODY_HEADER`.
  caller: CallerIdentity = UNKNOWN_CALLER,
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
      visibility: z.enum(["public", "private"]).optional().describe("op=set_visibility: 'public' shares the skill workspace-wide (every member can list and read it); 'private' makes it owner-only again. Owner or workspace-admin only. Team-scoped sharing is web-UI-managed."),
      detail: z.enum(["summary", "full"]).optional().describe("op=get: 'summary' returns metadata + body length WITHOUT the body (cheap orientation); 'full' (default) includes the SKILL.md body."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "list":
          return opList(client, args.folder ?? undefined);
        case "get": {
          const miss = missingParams("get", args, ["slug"]);
          if (miss) return miss;
          return opGet(client, args.slug as string, args.detail, caller.userId);
        }
        case "read": {
          const miss = missingParams("read", args, ["slug"]);
          if (miss) return miss;
          return opRead(client, args.slug as string, caller.userId);
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

/**
 * MCP tools for the user's skills. A skill is SINGLE-FILE: one tight markdown
 * procedure (SKILL.md) plus metadata; long reference material belongs in
 * knowledge bases (`dopl://kb/<slug>`). ⚠ Writes are gated server-side by the
 * per-skill `agent_write_enabled` toggle — without it, 403
 * `SKILL_AGENT_WRITE_DISABLED`.
 *
 * ⚠ ONE TOOL: reads + non-destructive writes. There is no delete op and no
 * `dopl_skill_admin` (deleted 2026-09-02) — deletion is app-only, fenced by
 * `sessionOnly` on `DELETE /api/skills/[skillSlug]`.
 *
 * Thin registrar: one description + schema + op routing, delegating to
 * `skills-shared.ts`, `skills-ops-read.ts`, `skills-ops-write.ts`. ⚠ The
 * `skills-` prefix is what the parity split-scan groups on.
 */

import { z } from "zod";
import type { DoplClient } from "@dopl/client";
import { UNKNOWN_CALLER, type CallerIdentity } from "./identity";
import { ok, missingParams, type RegisterTool, type ToolResponse } from "./respond";
import { SKILL_ERRORS } from "./tool-errors";
import { composeDescription, DESCRIPTION_MAX_CHARS } from "./tool-style";
import { SKILL_AUTHORING_GUIDE } from "../prompts/skill-authoring-guide.js";
import { opGet, opList, opRead } from "./skills-ops-read";
import {
  opCreate,
  opSetVisibility,
  opUpdate,
  opWrite,
} from "./skills-ops-write";

/**
 * ⚠ ONE OBJECT, REGISTERED AND DESCRIBED. `renderLimits` reads THIS shape, so
 * the description cannot state a cap the schema does not enforce.
 */
const SKILL_SHAPE = {
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
  confirm_token: z
    .string()
    .optional()
    .describe(
      "op=set_visibility: the one-time token from this call's own preview, echoed back to publish. Needed only when publishing into a home channel somebody else is in; refused on any other call, and never guessable.",
    ),
};

/**
 * ⚠ RENDERED, NOT WRITTEN — `tool-style.ts › composeDescription` holds the
 * order for every tool on this surface and refuses, at import, a headline over
 * its window or prose over its cap.
 *
 * ⚠ WHAT LEFT: the "Requires:" / "Optional:" clauses, the `expected_version`
 * 412 rule, the `agent_write_enabled` rejection and the two visibility values.
 * Every one of them is stated by the param's own `.describe()` below, and a
 * description and its arg descriptions are BOTH pushed on every connection —
 * so that was one fact bought twice.
 */
const SKILL_DESCRIPTION = composeDescription({
  headline:
    "The user's skills — one single-file procedure (SKILL.md) plus metadata each, as visible to you; not the skill inventory.",
  policy:
    "Reads plus non-destructive writes, gated per skill by the human-only `agent_write_enabled` toggle. No delete op — deletion is app-only.",
  routing: [
    "Use dopl_kb for long reference material, linked as `[label](dopl://kb/<slug>)`.",
  ],
  body: [
    `Set \`op\` to one of:
- "list" — ACTIVE skills visible to you, with triggers, grouped by folder. Two silent filters: drafts are absent (your own included), and skills private to another member or scoped to a team you have no grant on are dropped. A view — dopl_members(op="access_matrix") is the inventory. Call at every task boundary.
- "get" — resolved detail: SKILL.md body, reference availability, metadata.
- "read" — the SKILL.md body plus the Version token op="write" wants.
- "write" — replace the SKILL.md body.
- "create" — a new skill. Call op="authoring_guide" first.
- "update" — skill metadata.
- "set_visibility" — share workspace-wide, or make it owner-only.
- "authoring_guide" — the canonical skill-authoring framework.`,
  ],
  limits: { shape: SKILL_SHAPE, only: ["name"] },
  errors: SKILL_ERRORS,
  examples: [
    { op: "list" },
    { op: "list", folder: "Sales" },
    { op: "get", slug: "outreach" },
    { op: "write", slug: "outreach", body: "# …", expected_version: "3" },
  ],
  cap: DESCRIPTION_MAX_CHARS,
});


export function registerSkillTools(
  register: RegisterTool,
  client: DoplClient,
  // ⚠ Read for TWO things: whether a SKILL.md is somebody else's (which decides
  // `UNTRUSTED_SKILL_BODY_HEADER`), and who the confirm preview belongs to on
  // `set_visibility` (G16).
  caller: CallerIdentity = UNKNOWN_CALLER,
): void {
  register(
    "dopl_skill",
    SKILL_DESCRIPTION,
    SKILL_SHAPE,
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
          return opSetVisibility(
            client,
            caller.userId,
            args.slug as string,
            args.visibility as string,
            args.confirm_token,
          );
        }
        case "authoring_guide":
          return ok(SKILL_AUTHORING_GUIDE);
      }
    },
  );
}

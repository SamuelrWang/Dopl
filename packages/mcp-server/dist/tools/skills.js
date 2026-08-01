"use strict";
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
 *
 * This file is the thin registrar: it owns the two tool descriptions + schemas
 * + op routing and delegates each op to a handler in a sibling module —
 *   - `skills-shared.ts`    — NO_NAME, the op="list" scope line, error mappers
 *   - `skills-ops-read.ts`  — list/get/read
 *   - `skills-ops-write.ts` — write/create/update/set_visibility + the delete
 * Split at the §2 500-line cap on the same seam `knowledge.ts` and
 * `workflow.ts` use; the `skills-` prefix is what the parity split-scan groups on.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSkillTools = registerSkillTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const skill_authoring_guide_js_1 = require("../prompts/skill-authoring-guide.js");
const skills_ops_read_1 = require("./skills-ops-read");
const skills_ops_write_1 = require("./skills-ops-write");
const SKILL_DESCRIPTION = `Read and author the user's skills. A skill is SINGLE-FILE: one tight, self-contained procedure (its SKILL.md) plus metadata — NOT a folder of files. Long reference material (specs, tables, examples) belongs in a knowledge base, linked from the body as \`[label](dopl://kb/<slug>)\`; the skill stays short. Prefer MANY SMALL skills — one action each — over monoliths: small skills attach cleanly to ontology objects and workflow actions. Organize them with the \`folder\` label. Set \`op\` to one of:
- "list" — the ACTIVE skills VISIBLE TO YOU in the active workspace, with trigger metadata (name, description, when_to_use, when_not_to_use, status), grouped by folder. Two filters, and both hide rows silently: this op keeps only \`status\`="active" (drafts are absent, including your own), and the server has already dropped skills private to another member or scoped to a team you have no grant on. So this is a view, not the workspace's skill inventory, and two members legitimately get different counts from it; dopl_members(op="access_matrix") is the inventory. Call at every new task boundary. Optional: folder (filter to one folder).
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
function registerSkillTools(register, client) {
    register("dopl_skill", SKILL_DESCRIPTION, {
        op: zod_1.z
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
        slug: zod_1.z
            .string()
            .optional()
            .describe("Skill slug OR stable id (the uuid from list/get output — survives renames, prefer it for held references). Required for get, read, write, update, set_visibility."),
        name: zod_1.z.string().min(1).max(120).optional().describe("op=create (required) / op=update: skill name."),
        description: zod_1.z.string().min(1).max(2000).optional().describe("op=create (required) / op=update: skill description."),
        when_to_use: zod_1.z.string().min(1).max(2000).optional().describe("op=create (required) / op=update: when_to_use trigger."),
        when_not_to_use: zod_1.z.string().max(2000).nullable().optional().describe("op=create / op=update: when_not_to_use trigger."),
        new_slug: zod_1.z.string().min(1).max(80).optional().describe("op=update: rename the skill's slug."),
        status: zod_1.z.enum(["active", "draft"]).optional().describe("op=create / op=update: skill status (create defaults to active)."),
        agent_write_enabled: zod_1.z.boolean().optional().describe("op=create: initial agent-write toggle. On op=update an agent passing this is rejected — it's a human-only protection setting (change it from the Dopl web UI)."),
        folder: zod_1.z.string().max(80).nullable().optional().describe("op=create / op=update: organizing folder label (empty or null = unfiled). op=list: filter to skills in this folder."),
        body: zod_1.z.string().max(1_048_576).optional().describe("op=create: initial SKILL.md content. op=write (required): the new full SKILL.md body."),
        expected_version: zod_1.z.string().optional().describe("op=write: the Version from a prior read. Required when overwriting an existing body — omitting it fails with 412; only force=true skips the check."),
        force: zod_1.z.boolean().optional().describe("op=write: overwrite even if the body changed since you read it. Discards the other edit — use only when intentional."),
        visibility: zod_1.z.enum(["public", "private"]).optional().describe("op=set_visibility: 'public' shares the skill workspace-wide (referenceable in workflows); 'private' makes it owner-only again. Owner or workspace-admin only. Team-scoped sharing is web-UI-managed."),
        detail: zod_1.z.enum(["summary", "full"]).optional().describe("op=get: 'summary' returns metadata + body length WITHOUT the body (cheap orientation); 'full' (default) includes the SKILL.md body."),
    }, async (args) => {
        switch (args.op) {
            case "list":
                return (0, skills_ops_read_1.opList)(client, args.folder ?? undefined);
            case "get": {
                const miss = (0, respond_1.missingParams)("get", args, ["slug"]);
                if (miss)
                    return miss;
                return (0, skills_ops_read_1.opGet)(client, args.slug, args.detail);
            }
            case "read": {
                const miss = (0, respond_1.missingParams)("read", args, ["slug"]);
                if (miss)
                    return miss;
                return (0, skills_ops_read_1.opRead)(client, args.slug);
            }
            case "write": {
                const miss = (0, respond_1.missingParams)("write", args, ["slug", "body"]);
                if (miss)
                    return miss;
                return (0, skills_ops_write_1.opWrite)(client, args.slug, args.body, args.expected_version, args.force);
            }
            case "create": {
                const miss = (0, respond_1.missingParams)("create", args, ["name", "description", "when_to_use"]);
                if (miss)
                    return miss;
                return (0, skills_ops_write_1.opCreate)(client, args);
            }
            case "update": {
                const miss = (0, respond_1.missingParams)("update", args, ["slug"]);
                if (miss)
                    return miss;
                return (0, skills_ops_write_1.opUpdate)(client, args);
            }
            case "set_visibility": {
                const miss = (0, respond_1.missingParams)("set_visibility", args, ["slug", "visibility"]);
                if (miss)
                    return miss;
                return (0, skills_ops_write_1.opSetVisibility)(client, args.slug, args.visibility);
            }
            case "authoring_guide":
                return (0, respond_1.ok)(skill_authoring_guide_js_1.SKILL_AUTHORING_GUIDE);
        }
    });
    register("dopl_skill_admin", SKILL_ADMIN_DESCRIPTION, {
        op: zod_1.z.enum(["delete"]).describe("DESTRUCTIVE operation to perform."),
        slug: zod_1.z.string().optional().describe("Skill slug. Required for delete."),
    }, async (args) => {
        switch (args.op) {
            case "delete": {
                const miss = (0, respond_1.missingParams)("delete", args, ["slug"]);
                if (miss)
                    return miss;
                return (0, skills_ops_write_1.opDelete)(client, args.slug);
            }
        }
    });
}

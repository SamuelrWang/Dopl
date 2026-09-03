"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSkillTools = registerSkillTools;
const zod_1 = require("zod");
const identity_1 = require("./identity");
const respond_1 = require("./respond");
const tool_errors_1 = require("./tool-errors");
const tool_style_1 = require("./tool-style");
const skill_authoring_guide_js_1 = require("../prompts/skill-authoring-guide.js");
const skills_ops_read_1 = require("./skills-ops-read");
const skills_ops_write_1 = require("./skills-ops-write");
/**
 * ⚠ ONE OBJECT, REGISTERED AND DESCRIBED. `renderLimits` reads THIS shape, so
 * the description cannot state a cap the schema does not enforce.
 */
const SKILL_SHAPE = {
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
    visibility: zod_1.z.enum(["public", "private"]).optional().describe("op=set_visibility: 'public' shares the skill workspace-wide (every member can list and read it); 'private' makes it owner-only again. Owner or workspace-admin only. Team-scoped sharing is web-UI-managed."),
    detail: zod_1.z.enum(["summary", "full"]).optional().describe("op=get: 'summary' returns metadata + body length WITHOUT the body (cheap orientation); 'full' (default) includes the SKILL.md body."),
    confirm_token: zod_1.z
        .string()
        .optional()
        .describe("op=set_visibility: the one-time token from this call's own preview, echoed back to publish. Needed only when publishing into a home channel somebody else is in; refused on any other call, and never guessable."),
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
const SKILL_DESCRIPTION = (0, tool_style_1.composeDescription)({
    headline: "The user's skills — one single-file procedure (SKILL.md) plus metadata each, as visible to you; not the skill inventory.",
    policy: "Reads plus non-destructive writes, gated per skill by the human-only `agent_write_enabled` toggle. No delete op — deletion is app-only.",
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
    errors: tool_errors_1.SKILL_ERRORS,
    examples: [
        { op: "list" },
        { op: "list", folder: "Sales" },
        { op: "get", slug: "outreach" },
        { op: "write", slug: "outreach", body: "# …", expected_version: "3" },
    ],
    cap: tool_style_1.DESCRIPTION_MAX_CHARS,
});
function registerSkillTools(register, client, 
// ⚠ Read for TWO things: whether a SKILL.md is somebody else's (which decides
// `UNTRUSTED_SKILL_BODY_HEADER`), and who the confirm preview belongs to on
// `set_visibility` (G16).
caller = identity_1.UNKNOWN_CALLER) {
    register("dopl_skill", SKILL_DESCRIPTION, SKILL_SHAPE, async (args) => {
        switch (args.op) {
            case "list":
                return (0, skills_ops_read_1.opList)(client, args.folder ?? undefined);
            case "get": {
                const miss = (0, respond_1.missingParams)("get", args, ["slug"]);
                if (miss)
                    return miss;
                return (0, skills_ops_read_1.opGet)(client, args.slug, args.detail, caller.userId);
            }
            case "read": {
                const miss = (0, respond_1.missingParams)("read", args, ["slug"]);
                if (miss)
                    return miss;
                return (0, skills_ops_read_1.opRead)(client, args.slug, caller.userId);
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
                return (0, skills_ops_write_1.opSetVisibility)(client, caller.userId, args.slug, args.visibility, args.confirm_token);
            }
            case "authoring_guide":
                return (0, respond_1.ok)(skill_authoring_guide_js_1.SKILL_AUTHORING_GUIDE);
        }
    });
}

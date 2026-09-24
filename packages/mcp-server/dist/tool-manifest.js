"use strict";
/**
 * THE GRANULAR TOOL SURFACE (DMP-013), one verb_noun tool per job, and the legacy call each one
 * runs. `registrar.ts › registerGranular` serves it from this table; the connection's tool set picks
 * which set is listed, and the other stays callable; `granular-text.ts` holds what each tool says. Read/write
 * class, annotations and the `container` arg are DERIVED from `gating.ts › isWriteOp`, `delete-policy.ts`
 * and `workspace-arg.ts` — never restated here.
 *
 * A binding key is `Gates.requestedOp`'s grain: `<legacy tool>:<op>` or `<legacy tool>:<op>.<action>`,
 * bare `<legacy tool>` for the three that take no op. `tool-manifest.test.ts` pins coverage (every
 * legacy key bound exactly once, no delete op), the annotation truth and the naming rules.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_TOOL_NAMES = exports.GRANULAR_TOOL_NAMES = exports.GRANULAR_TOOLS = exports.ALWAYS_LOAD_META = exports.TOOL_SETS_CAPABILITY = exports.TOOL_SETS = void 0;
exports.resolveToolSet = resolveToolSet;
exports.parseBinding = parseBinding;
exports.jobsOf = jobsOf;
exports.bindingsOf = bindingsOf;
exports.selectorOf = selectorOf;
exports.servesName = servesName;
exports.unlistedFor = unlistedFor;
exports.withGranularTools = withGranularTools;
exports.isReadOnlyTool = isReadOnlyTool;
exports.bindsDeleteOp = bindsDeleteOp;
exports.annotationsFor = annotationsFor;
const gating_js_1 = require("./gating.js");
const delete_policy_js_1 = require("./delete-policy.js");
/** The tool sets a connection may ask for (`X-Dopl-Tool-Set`, else `?tools=`). */
exports.TOOL_SETS = ["legacy", "granular"];
/**
 * The `initialize` capability that says this server serves both sets, so a client asks for
 * `granular` only where it will be honoured (the desktop reads it off its launch pre-flight). An
 * older server omits it and every client stays on the default.
 */
exports.TOOL_SETS_CAPABILITY = "dopl/toolSets";
/**
 * A named set wins. With none (or one this server cannot place), a desktop-run caller
 * (`identity.ts › isDesktopRun`) gets `legacy` — a desktop that does not negotiate knows only those
 * names and gates by them — and everyone else `granular`. A set names tools; it grants nothing.
 */
function resolveToolSet(claimed, desktopRun) {
    return exports.TOOL_SETS.find((set) => set === claimed) ?? (desktopRun ? "legacy" : "granular");
}
/**
 * The per-tool `_meta` Claude Code reads as "never defer" — any transport, OR'd with the server
 * entry's `alwaysLoad` (bundled CLI 0.3.220: `alwaysLoad: config.alwaysLoad || _meta["anthropic/alwaysLoad"]`).
 */
exports.ALWAYS_LOAD_META = { "anthropic/alwaysLoad": true };
exports.GRANULAR_TOOLS = [
    // ── Orientation ─────────────────────────────────────────────────────────
    { name: "dopl_get_map", bind: "dopl_map", params: [], alwaysLoad: true },
    {
        name: "dopl_search",
        bind: { everything: "dopl_search", knowledge: "dopl_kb:search" },
        select: "within",
        // Shares the legacy tool's name, so a legacy `dopl_search` call lands here in the granular set.
        selectDefault: "everything",
        params: ["query", "limit", "scope", "base", "response_format"],
        alwaysLoad: true,
    },
    { name: "dopl_get_status", bind: "dopl_status", params: ["since"], alwaysLoad: true },
    { name: "dopl_list_workspaces", bind: "dopl_workspaces:list", params: [] },
    { name: "dopl_create_workspace", bind: "dopl_workspaces:create_home_channel", params: ["name"] },
    {
        name: "dopl_get_guide",
        bind: {
            channels: "dopl_channel:rooms.help",
            skill_authoring: "dopl_skill:authoring_guide",
            chats: "dopl_chats:guide",
        },
        select: "topic",
        pulled: { knowledge: "dopl://doctrine/knowledge" },
        params: ["section"],
    },
    // ── Channels ────────────────────────────────────────────────────────────
    { name: "dopl_list_channels", bind: "dopl_channel:rooms.list", params: [] },
    {
        name: "dopl_get_channel",
        bind: {
            status: "dopl_channel:status",
            members: "dopl_channel:rooms.members",
            threads: "dopl_channel:rooms.threads",
        },
        params: ["channel"],
    },
    {
        name: "dopl_read_channel",
        bind: "dopl_channel:read",
        params: ["channel", "thread", "since", "limit", "wait_ms", "response_format"],
        alwaysLoad: true,
    },
    {
        name: "dopl_send_message",
        bind: "dopl_channel:send",
        params: ["channel", "to", "body", "kind", "thread", "summary", "client_msg_id"],
        alwaysLoad: true,
    },
    {
        name: "dopl_request_decision",
        bind: "dopl_channel:send",
        preset: { kind: "decision" },
        params: ["channel", "body", "thread", "summary", "options", "recommendation", "client_msg_id"],
        alwaysLoad: true,
    },
    {
        name: "dopl_create_channel",
        bind: "dopl_channel:rooms.open",
        params: ["name", "visibility", "to"],
        carry: ["description"],
    },
    {
        name: "dopl_update_channel",
        bind: { update: "dopl_channel:rooms.update", thread_mode: "dopl_channel:rooms.thread_mode" },
        params: ["channel", "name", "info_card", "thread", "mode"],
        carry: ["description"],
        destructive: true,
        idempotent: true,
    },
    {
        name: "dopl_invite_to_channel",
        bind: "dopl_channel:rooms.invite",
        params: ["channel", "to"],
        idempotent: true,
    },
    {
        name: "dopl_launch_agent",
        bind: "dopl_channel:manage.launch",
        params: ["channel", "name", "thread", "body", "model", "runtime", "identity", "color", "posture", "client_msg_id", "wait_ms"],
    },
    {
        name: "dopl_manage_session",
        bind: {
            end: "dopl_channel:manage.end",
            rename: "dopl_channel:manage.rename",
            posture: "dopl_channel:manage.posture",
            direct: "dopl_channel:manage.direct",
        },
        params: ["channel", "to", "name", "posture", "body", "client_msg_id", "wait_ms"],
        destructive: true,
    },
    {
        name: "dopl_manage_artifact",
        bind: {
            create: "dopl_channel:artifact.create",
            add: "dopl_channel:artifact.add",
            remove: "dopl_channel:artifact.remove",
            dissolve: "dopl_channel:artifact.dissolve",
        },
        params: ["channel", "artifact", "messages", "name", "summary", "client_msg_id"],
        destructive: true,
    },
    // ── Knowledge ───────────────────────────────────────────────────────────
    {
        name: "dopl_browse_knowledge",
        bind: {
            list_bases: "dopl_kb:list_bases",
            tree: "dopl_kb:get_tree",
            list_dir: "dopl_kb:list_dir",
            outline: "dopl_kb:outline",
        },
        params: ["base", "path", "entry_limit", "entry_cursor"],
    },
    {
        name: "dopl_read_entry",
        bind: "dopl_kb:read_file",
        params: ["base", "path", "section", "max_chars", "offset", "response_format"],
        alwaysLoad: true,
    },
    {
        name: "dopl_write_entry",
        bind: "dopl_kb:write_file",
        params: ["base", "path", "section", "body", "title", "excerpt", "expected_version", "force", "client_write_id"],
        destructive: true,
        idempotent: true,
        alwaysLoad: true,
    },
    {
        name: "dopl_manage_knowledge",
        bind: {
            create_base: "dopl_kb:create_base",
            update_base: "dopl_kb:update_base",
            create_folder: "dopl_kb:create_folder",
            move_folder: "dopl_kb:move_folder",
            move_entry: "dopl_kb:move_file",
            publish: "dopl_kb:set_visibility",
            grant: "dopl_kb:grant",
        },
        params: [
            "base", "path", "from_path", "to_path", "name", "description", "slug", "visibility",
            "scope", "to", "level", "confirm_token", "client_write_id",
        ],
        destructive: true,
    },
    // ── Skills ──────────────────────────────────────────────────────────────
    { name: "dopl_list_skills", bind: "dopl_skill:list", params: ["folder"] },
    {
        name: "dopl_get_skill",
        bind: { details: "dopl_skill:get", body: "dopl_skill:read" },
        select: "view",
        params: ["slug", "detail"],
    },
    {
        name: "dopl_create_skill",
        bind: "dopl_skill:create",
        params: ["name", "description", "when_to_use", "when_not_to_use", "status", "agent_write_enabled", "folder", "body"],
    },
    {
        name: "dopl_update_skill",
        bind: { update: "dopl_skill:update", write: "dopl_skill:write", visibility: "dopl_skill:set_visibility" },
        params: [
            "slug", "name", "description", "when_to_use", "when_not_to_use", "new_slug", "status", "folder",
            "body", "expected_version", "force", "visibility", "confirm_token",
        ],
        destructive: true,
        idempotent: true,
    },
    // ── Agent identities ────────────────────────────────────────────────────
    { name: "dopl_list_agents", bind: "dopl_agent:list", params: [] },
    { name: "dopl_get_agent", bind: "dopl_agent:get", params: ["identity", "max_chars"] },
    {
        name: "dopl_manage_agent",
        bind: { create: "dopl_agent:create", update: "dopl_agent:update", grant: "dopl_agent:grant" },
        params: [
            "identity", "name", "description", "instructions", "model", "runtime", "fields", "visibility",
            "knowledge_bases", "knowledge", "expected_version", "force", "confirm_token", "scope", "to", "level",
        ],
        destructive: true,
    },
    // ── Ontology ────────────────────────────────────────────────────────────
    {
        name: "dopl_browse_ontology",
        bind: { map: "dopl_ontology:map", anchor: "dopl_ontology:anchor", resolve: "dopl_ontology:resolve" },
        params: ["query"],
    },
    {
        name: "dopl_get_object",
        bind: "dopl_ontology:get",
        params: ["object", "response_format"],
    },
    {
        name: "dopl_edit_object",
        bind: {
            create: "dopl_ontology:create_object",
            update: "dopl_ontology:update_object",
            set_template_field: "dopl_ontology:set_template_field",
            remove_template_field: "dopl_ontology:remove_template_field",
            set_attribute: "dopl_ontology:set_attribute",
            remove_attribute: "dopl_ontology:remove_attribute",
            set_relationship: "dopl_ontology:set_relationship",
            remove_relationship: "dopl_ontology:remove_relationship",
            set_action: "dopl_ontology:set_action",
            remove_action: "dopl_ontology:remove_action",
            claim_anchor: "dopl_ontology:claim_anchor",
        },
        params: [
            "object", "parent", "name", "subtitle", "label", "kind", "value", "values",
            "targets", "description", "outcome", "tools", "expected_version",
        ],
        destructive: true,
    },
    {
        name: "dopl_manage_ontology",
        bind: {
            create: "dopl_ontology:create_ontology",
            update: "dopl_ontology:update_ontology",
            create_column: "dopl_ontology:create_column",
        },
        params: ["ontology", "name", "purpose"],
        destructive: true,
    },
    // ── Members ─────────────────────────────────────────────────────────────
    {
        name: "dopl_get_member",
        bind: {
            me: "dopl_members:whoami",
            member: "dopl_members:get",
            team: "dopl_members:get_team",
            my_access: "dopl_members:my_access",
        },
        select: "who",
        params: ["member", "team"],
    },
    {
        name: "dopl_list_members",
        bind: {
            members: "dopl_members:list",
            teams: "dopl_members:teams",
            access_matrix: "dopl_members:access_matrix",
        },
        select: "list",
        params: ["fields"],
    },
    // ── Chats ───────────────────────────────────────────────────────────────
    {
        name: "dopl_list_chats",
        bind: { chats: "dopl_chats:list", folders: "dopl_chats:folders" },
        select: "list",
        params: ["scope", "query"],
    },
    { name: "dopl_get_chat", bind: "dopl_chats:get", params: ["chat_id"] },
    {
        name: "dopl_save_chat",
        bind: {
            export: "dopl_chats:export",
            append: "dopl_chats:append",
            update: "dopl_chats:update",
            create_folder: "dopl_chats:create_folder",
            update_folder: "dopl_chats:update_folder",
        },
        params: [
            "chat_id", "title", "overview", "messages", "deliverables", "learnings", "client_session_id",
            "session_date", "source", "project", "folder", "visibility", "pinned", "name", "folder_id",
        ],
        destructive: true,
    },
    // ── Versions ────────────────────────────────────────────────────────────
    {
        name: "dopl_list_versions",
        bind: { entry: "dopl_kb:history", skill: "dopl_skill:history", object: "dopl_ontology:history" },
        select: "resource",
        params: ["base", "path", "slug", "object", "ontology", "revision", "limit", "entry_cursor"],
    },
    {
        name: "dopl_restore_version",
        bind: { entry: "dopl_kb:restore", skill: "dopl_skill:restore", object: "dopl_ontology:restore" },
        select: "resource",
        params: ["base", "path", "slug", "object", "revision", "expected_version"],
        destructive: true,
    },
];
/** A binding key split into the legacy tool and its gate key (`op` or `op.action`). */
function parseBinding(key) {
    const colon = key.indexOf(":");
    return colon < 0 ? { tool: key, op: undefined } : { tool: key.slice(0, colon), op: key.slice(colon + 1) };
}
/** Each job as [selector value, binding]; the value is null for a one-job tool. */
function jobsOf(t) {
    return typeof t.bind === "string" ? [[null, t.bind]] : Object.entries(t.bind);
}
function bindingsOf(t) {
    return jobsOf(t).map(([, key]) => key);
}
/** The arg that picks the job, or null for a one-job tool. */
function selectorOf(t) {
    return typeof t.bind === "string" ? null : (t.select ?? "action");
}
exports.GRANULAR_TOOL_NAMES = new Set(exports.GRANULAR_TOOLS.map((t) => t.name));
/** The legacy surface, as the manifest binds it (the test pins that it binds every legacy key). */
exports.LEGACY_TOOL_NAMES = new Set(exports.GRANULAR_TOOLS.flatMap(bindingsOf).map((key) => parseBinding(key).tool));
const namesOf = (set) => (set === "granular" ? exports.GRANULAR_TOOL_NAMES : exports.LEGACY_TOOL_NAMES);
/** Is `family`'s tool `name` registered while `set` is active? A name both sets use goes to the active one. */
function servesName(set, family, name) {
    return family === set || !namesOf(set).has(name);
}
/** The inactive set: registered and callable, absent from `tools/list`, so stale prompts still work. */
function unlistedFor(set) {
    const inactive = namesOf(set === "granular" ? "legacy" : "granular");
    return new Set([...inactive].filter((name) => !namesOf(set).has(name)));
}
/**
 * A profile's legacy offer widened to the granular tools with a bound legacy tool it offers; such a
 * tool serves only those jobs (`granular.ts › granularShape`).
 */
function withGranularTools(offer) {
    if (offer === null)
        return null;
    const covered = exports.GRANULAR_TOOLS.filter((t) => bindingsOf(t).some((key) => offer.has(parseBinding(key).tool)));
    return new Set([...offer, ...covered.map((t) => t.name)]);
}
function someBinding(t, test) {
    return bindingsOf(t).some((key) => {
        const { tool, op } = parseBinding(key);
        return test(tool, op);
    });
}
/** Read-only iff no bound key is a gated write. */
function isReadOnlyTool(t) {
    return !someBinding(t, (tool, op) => op !== undefined && (0, gating_js_1.isWriteOp)(tool, op));
}
/** A binding the delete policy refuses — must be false for every tool. */
function bindsDeleteOp(t) {
    return someBinding(t, (tool, op) => op !== undefined && (0, delete_policy_js_1.isBlockedDeleteOp)(tool, op.split(".")[0]));
}
/** Every hint explicit: the MCP defaults (destructive, open-world) are wrong for a write here. */
function annotationsFor(t) {
    if (isReadOnlyTool(t))
        return { readOnlyHint: true, openWorldHint: false };
    return {
        readOnlyHint: false,
        destructiveHint: t.destructive === true,
        idempotentHint: t.idempotent === true,
        openWorldHint: false,
    };
}

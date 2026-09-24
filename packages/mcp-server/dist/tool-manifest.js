"use strict";
/**
 * THE GRANULAR TOOL SURFACE (DMP-013), one verb_noun tool per job, and the legacy call each one
 * runs. Nothing serves it yet: B1 registers from this table, and until then the legacy surface is
 * the only one on the wire. Read/write class, annotations and the `container` arg are DERIVED from
 * `gating.ts › isWriteOp`, `delete-policy.ts` and `workspace-arg.ts` — never restated here.
 *
 * A binding key is `Gates.requestedOp`'s grain: `<legacy tool>:<op>` or `<legacy tool>:<op>.<action>`,
 * bare `<legacy tool>` for the three that take no op. `tool-manifest.test.ts` pins coverage (every
 * legacy key bound exactly once, no delete op), the annotation truth and the naming rules.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRANULAR_TOOLS = exports.ALWAYS_LOAD_META = exports.TOOL_SETS = void 0;
exports.resolveToolSet = resolveToolSet;
exports.parseBinding = parseBinding;
exports.bindingsOf = bindingsOf;
exports.isReadOnlyTool = isReadOnlyTool;
exports.bindsDeleteOp = bindsDeleteOp;
exports.takesContainer = takesContainer;
exports.annotationsFor = annotationsFor;
const gating_js_1 = require("./gating.js");
const delete_policy_js_1 = require("./delete-policy.js");
const workspace_arg_js_1 = require("./workspace-arg.js");
/** The tool sets a connection may ask for (`X-Dopl-Tool-Set`, else `?tools=`); the first is the default. */
exports.TOOL_SETS = ["legacy", "granular"];
/** An absent or unplaceable claim gets the default: a set names tools, it grants nothing. */
function resolveToolSet(claimed) {
    return exports.TOOL_SETS.find((set) => set === claimed) ?? exports.TOOL_SETS[0];
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
        params: ["query", "limit", "scope", "base", "response_format"],
        alwaysLoad: true,
    },
    { name: "dopl_get_status", bind: "dopl_status", params: ["since", "response_format"], alwaysLoad: true },
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
        params: ["channel", "response_format"],
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
        params: ["channel", "to", "body", "thread", "summary", "options", "recommendation", "client_msg_id"],
        alwaysLoad: true,
    },
    {
        name: "dopl_create_channel",
        bind: "dopl_channel:rooms.open",
        params: ["name", "summary", "visibility", "to"],
    },
    {
        name: "dopl_update_channel",
        bind: { update: "dopl_channel:rooms.update", thread_mode: "dopl_channel:rooms.thread_mode" },
        params: ["channel", "name", "summary", "info_card", "thread", "mode"],
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
        params: ["channel", "name", "body", "model", "runtime", "identity", "color", "posture", "client_msg_id", "wait_ms"],
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
        params: ["ontology", "object", "query", "response_format"],
    },
    {
        name: "dopl_get_object",
        bind: "dopl_ontology:get",
        params: ["object", "ontology", "response_format"],
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
            "object", "ontology", "parent", "name", "subtitle", "label", "kind", "value", "values",
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
        params: ["ontology", "name", "purpose", "expected_version"],
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
        params: ["base", "path", "slug", "object", "ontology", "revision", "expected_version"],
        destructive: true,
    },
];
/** A binding key split into the legacy tool and its gate key (`op` or `op.action`). */
function parseBinding(key) {
    const colon = key.indexOf(":");
    return colon < 0 ? { tool: key, op: undefined } : { tool: key.slice(0, colon), op: key.slice(colon + 1) };
}
function bindingsOf(t) {
    return typeof t.bind === "string" ? [t.bind] : Object.values(t.bind);
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
/** `container` is published iff some bound op still honours it (`workspace-arg.ts`). */
function takesContainer(t) {
    return someBinding(t, workspace_arg_js_1.acceptsWorkspaceArg);
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

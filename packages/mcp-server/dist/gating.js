"use strict";
/**
 * The gates and their tables. Both registration helpers call them explicitly: `registerMetaTool`
 * bypasses `registerTool`'s wrapper, so never fold them into one. `tools/parity-harness.ts` parses
 * this source text; `tool-profile.test.ts` bans its PERSONA_WORDS here, comments included.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WRITE_OPS = exports.NARROWEST_TOOL_PROFILE = exports.TOOL_PROFILES = exports.HIDDEN_TOOLS = void 0;
exports.offeredToolsFor = offeredToolsFor;
exports.isWriteOp = isWriteOp;
exports.createGates = createGates;
const delete_policy_js_1 = require("./delete-policy.js");
const tool_errors_js_1 = require("./tools/tool-errors.js");
// Hide-then-delete step one (empty is normal); every name must still be registered.
exports.HIDDEN_TOOLS = new Set([]);
/**
 * Containment profiles `X-Dopl-Tool-Profile` may name (`tool-profiles.js › KNOWN_PROFILES`),
 * narrowest first. A profile says how much of the machine a session may touch, never what it is for.
 */
exports.TOOL_PROFILES = [
    "read_only",
    "dopl_only",
    "channel_agent",
    "full",
];
// A value the server cannot place falls to the narrowest profile (fail closed, like the desktop's
// `normalizeProfile`); an absent header is no claim and keeps the whole surface.
exports.NARROWEST_TOOL_PROFILE = exports.TOOL_PROFILES[0];
// Mirrors the desktop's `tool-profiles.js › DOPL_SAFE_TOOLS` (everything but `dopl_channel`); an
// allow list, so a new tool is classified before a contained session is offered it.
const DOPL_ONLY_TOOLS = new Set([
    "dopl_kb",
    "dopl_search",
    "dopl_map",
    "dopl_members",
    "dopl_skill",
    "dopl_ontology",
    "dopl_chats",
    "dopl_agent",
    "dopl_status",
    "dopl_workspaces",
]);
// Profile → offered tools (`null` = whole surface). Profiles only NARROW the offered tool set and
// gate nothing: the value is caller-supplied and the desktop gate is authoritative.
const PROFILE_TOOLS = {
    // The desktop denies this profile the whole `mcp__dopl` prefix.
    read_only: new Set([]),
    dopl_only: DOPL_ONLY_TOOLS,
    // `full` minus the shell tool — a built-in this server does not serve.
    channel_agent: null,
    full: null,
};
function normalizeToolProfile(claimed) {
    return exports.TOOL_PROFILES.includes(claimed)
        ? claimed
        : exports.NARROWEST_TOOL_PROFILE;
}
/**
 * The tools this session is offered, or `null` for no narrowing. Tested on the type: `""` is a
 * profile claim (`tool-profile-header.ts › UNREADABLE_TOOL_PROFILE`), never the full surface.
 */
function offeredToolsFor(claimed) {
    if (typeof claimed !== "string")
        return null;
    return PROFILE_TOOLS[normalizeToolProfile(claimed)];
}
/**
 * Per-op write gating for mixed read+write tools; a new write op must be added here or a
 * `dopl.read` token can write through it. Inside these `new Set([ … ])` blocks only op names may be
 * double-quoted, comments included: `tools/parity-harness.ts` and the desktop's
 * `knowledge-read-ops.test.mjs` parse the source text and read every quoted word as an op.
 */
exports.WRITE_OPS = {
    dopl_ontology: new Set([
        "create_cluster",
        "update_cluster",
        "create_column",
        "create_object",
        "update_object",
        "set_template_field",
        "remove_template_field",
        "set_attribute",
        "remove_attribute",
        "set_relationship",
        "remove_relationship",
        "set_action",
        "remove_action",
        "claim_anchor",
    ]),
    dopl_kb: new Set([
        "create_base",
        "update_base",
        "create_folder",
        "move_folder",
        "write_file",
        "move_file",
        "set_visibility",
        "grant",
    ]),
    dopl_skill: new Set([
        "create",
        "update",
        "write",
        "set_visibility",
    ]),
    // update can widen visibility (a share); grant lends to another scope (`resource_grants`).
    dopl_agent: new Set(["create", "update", "grant"]),
    dopl_chats: new Set(["export", "append", "update", "create_folder", "update_folder"]),
    // Its `op` defaults to the read: an absent op is never refused, so a write default escapes (F-621).
    dopl_workspaces: new Set(["create_home_channel"]),
    // `rooms` both reads and writes, so it is gated per action; see {@link isWriteOp}.
    dopl_channel: new Set([
        "send",
        // A write even for rename: it mutates a live process or a local store, not a readable row.
        "manage",
        // rooms.update also reads when `info_card` is omitted; an action that can write is gated whole.
        "rooms.open",
        "rooms.invite",
        "rooms.thread_mode",
        "rooms.update",
        // Every action writes (`channel-vocab.ts › CHANNEL_ACTIONS.artifact`); a new one fails closed.
        "artifact",
    ]),
};
/**
 * Does `op` ({@link Gates.requestedOp}'s key) write? A bare entry gates every action of its op, a
 * dotted one (`rooms.open`) one action; a bare call to an op with dotted write entries fails closed.
 */
function isWriteOp(name, op) {
    const writes = exports.WRITE_OPS[name];
    if (!writes)
        return false;
    if (writes.has(op))
        return true;
    const dot = op.indexOf(".");
    if (dot > 0)
        return writes.has(op.slice(0, dot));
    for (const entry of writes) {
        if (entry.startsWith(`${op}.`))
            return true;
    }
    return false;
}
/** `canWrite` fails closed upstream (explicit `dopl.write` only); `offeredTools` is resolved. */
function createGates(canWrite, offeredTools = null) {
    function isSuppressedTool(name) {
        if (exports.HIDDEN_TOOLS.has(name))
            return true;
        return offeredTools !== null && !offeredTools.has(name);
    }
    // `<op>.<action>` when the call names an action — generic, never per-tool.
    function requestedOp(args) {
        const bag = args;
        const op = bag?.op;
        if (typeof op !== "string")
            return undefined;
        const action = bag?.action;
        return typeof action === "string" ? `${op}.${action}` : op;
    }
    function opRefusal(name, op) {
        if (op === undefined)
            return null;
        // The base op: delete-blocked ops are claims about the op enum, which carries no action.
        if ((0, delete_policy_js_1.isBlockedDeleteOp)(name, op.split(".")[0])) {
            return {
                isError: true,
                content: [{ type: "text", text: delete_policy_js_1.DELETE_REFUSAL }],
            };
        }
        if (!canWrite && isWriteOp(name, op)) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: (0, tool_errors_js_1.refusal)(tool_errors_js_1.READ_ONLY_SESSION, `\`${name}\` op="${op}" is a write operation. Reconnect with write access to perform it.`),
                    },
                ],
            };
        }
        return null;
    }
    return { isSuppressedTool, requestedOp, opRefusal };
}

"use strict";
/**
 * gating.ts — THE FOUR GATES, and the three tables they read.
 *
 * ⚠ THE TOPOLOGY IS THE INVARIANT. TWO gates run at REGISTRATION (the tool
 * never exists) and TWO per CALL (the op is refused):
 *
 *   registration → {@link Gates.isSuppressedTool}: HIDDEN_TOOLS and, for a
 *                  read-only session, READ_ONLY_BLOCKED_TOOLS.
 *   per call     → {@link Gates.opRefusal}: the app-only-deletion block FIRST
 *                  and unconditionally, then the write-scope gate.
 *
 * ⚠ They live HERE, outside the registration wrapper, because
 * `registerMetaTool` registers straight onto the SDK server — inline gating
 * published two tools that passed through none of them. Do NOT push these back
 * inside a wrapper; both registration helpers call them explicitly.
 *
 * ⚠ ORDERING INSIDE `opRefusal` IS LOAD-BEARING: the delete refusal fires
 * first and unconditionally, before workspace resolution and any client call,
 * so a refused delete costs zero round trips and can never half-happen. It must
 * never become reachable only after another gate lets the call through.
 *
 * ⚠ `parity.test.ts` / `delete-block.test.ts` PARSE `WRITE_OPS`,
 * `READ_ONLY_BLOCKED_TOOLS` and `HIDDEN_TOOLS` out of this file's SOURCE TEXT
 * (`tools/parity-harness.ts`). The parse follows the constant, not the filename.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WRITE_OPS = exports.READ_ONLY_BLOCKED_TOOLS = exports.HIDDEN_TOOLS = void 0;
exports.createGates = createGates;
const delete_policy_js_1 = require("./delete-policy.js");
/**
 * THE HIDE-BEFORE-DELETE SEAM — a registered tool an agent no longer sees.
 * Empty is the current state, not a dead mechanism: retirement is two steps
 * (hide, then delete), and this is step one's whole implementation.
 *
 * ⚠ A tool that no longer EXISTS must not be listed here —
 * `delete-block.test.ts` asserts every HIDDEN name still has a registrar, and a
 * name with none is a claim about a gate that guards nothing.
 *
 * ⚠ At the REGISTRAR, not the route: the MCP server reaches the app's routes
 * over LOOPBACK HTTP through `DoplClient`, so gating a route 500s the tool while
 * the agent still SEES it in `tools/list`. Unregistered = absent = nothing to
 * call. Same choke point as `READ_ONLY_BLOCKED_TOOLS` below.
 */
exports.HIDDEN_TOOLS = new Set([]);
/** Purely destructive tools aren't even registered for a read-only session. */
exports.READ_ONLY_BLOCKED_TOOLS = new Set([
    "dopl_chats_admin",
    "dopl_kb_admin",
    "dopl_skill_admin",
    "dopl_ontology_admin",
]);
/**
 * Per-op write gating for MIXED read+write tools — they stay registered for
 * read-only sessions so reads work, but write ops are refused. ⚠ Keep each set
 * in sync with the tool's `op` enum: a new write op MUST be added here, or a
 * `dopl.read`-only token can write through a non-admin tool.
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
    ]),
    dopl_skill: new Set([
        "create",
        "update",
        "write",
        "set_visibility",
    ]),
    dopl_chats: new Set(["export", "append", "update", "create_folder", "update_folder"]),
    dopl_channel: new Set([
        "open",
        "invite",
        "post",
        // `milestone` and `propose_close` both write a message.
        // ⚠ `close_thread` STAYS here even though the registrar answers it with a
        // refusal: a read-only token must be refused for the SCOPE reason first, or
        // the shape of the two errors tells a read-only caller which threads exist.
        "milestone",
        "create_thread",
        "propose_close",
        "close_thread",
        "set_thread_mode",
    ]),
};
/**
 * Build the gates for one session. ⚠ `canWrite` is the OAuth scope verdict and
 * FAILS CLOSED upstream — write/admin only on an explicit `dopl.write`.
 */
function createGates(canWrite) {
    function isSuppressedTool(name) {
        if (exports.HIDDEN_TOOLS.has(name))
            return true;
        return !canWrite && exports.READ_ONLY_BLOCKED_TOOLS.has(name);
    }
    function requestedOp(args) {
        const op = args?.op;
        return typeof op === "string" ? op : undefined;
    }
    function opRefusal(name, op) {
        if (op === undefined)
            return null;
        if ((0, delete_policy_js_1.isBlockedDeleteOp)(name, op)) {
            return {
                isError: true,
                content: [{ type: "text", text: delete_policy_js_1.DELETE_REFUSAL }],
            };
        }
        if (!canWrite && exports.WRITE_OPS[name]?.has(op)) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `This session is read-only — its token lacks the \`dopl.write\` scope. \`${name}\` op="${op}" is a write operation. Reconnect with write access to perform it.`,
                    },
                ],
            };
        }
        return null;
    }
    return { isSuppressedTool, requestedOp, opRefusal };
}

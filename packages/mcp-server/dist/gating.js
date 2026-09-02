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
    "dopl_agent_admin",
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
    // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: `tools/parity-harness.ts` parses this set
    // out of the SOURCE TEXT, so a quoted phrase in a comment is read as an op
    // name and fails the WRITE_OPS-subset-of-enum check.
    // ⚠ BOTH verbs write, and update is the one easiest to miss: it can raise a
    // template to workspace visibility, which is the SHARE act itself (a template
    // has no grant table). A read-only token must be refused it.
    dopl_agent: new Set(["create", "update"]),
    // ⚠ `dopl_home` REGISTERS ON THE META PATH AND IS STILL GATED HERE, because
    // `opRefusal` is called explicitly on BOTH registration paths — which is the
    // whole reason the gates were hoisted out of the domain wrapper. A read-only
    // token lists home channels and creates none.
    dopl_home: new Set(["create_channel"]),
    dopl_chats: new Set(["export", "append", "update", "create_folder", "update_folder"]),
    dopl_channel: new Set([
        "open",
        "invite",
        "post",
        // `milestone` writes a message.
        // ⚠ `propose_close` and `close_thread` were here until thread closing was
        // removed (wiring plan Phase 4, 2026-08-18). `close_thread` was listed even
        // though the registrar answered it with a refusal, and the reason still
        // applies to any future teaching-refusal op: a read-only token must be
        // refused for the SCOPE reason FIRST, or the shape of the two errors tells a
        // read-only caller which threads exist.
        "milestone",
        "create_thread",
        "set_thread_mode",
        // ⚠ `escalate` WRITES. It is a post under the hood — a real message row in a
        // room every member reads — and a read-only token must be refused it for the
        // SCOPE reason like any other post, not merely because the payload is
        // structured.
        "escalate",
        // ⚠ `direct_agent` WRITES. It files a `channel_agent_directions` row and asks
        // a machine to start a TURN on a running agent — not merely a read that
        // happens to wait, and a read-only token must be refused it.
        // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: the parity harness parses this set out of
        // the SOURCE TEXT, so a quoted phrase in a comment is read as an op name.
        "direct_agent",
        // ⚠ `launch_agent` WRITES. It files a `channel_launch_directives` row and
        // asks a machine to start a process — it is not merely a read that happens
        // to wait, and a read-only token must be refused it or a `dopl.read` session
        // can spawn agents through a non-admin tool.
        // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: `tools/parity-harness.ts` parses this
        // set out of the SOURCE TEXT, so a quoted phrase in a comment is read as an
        // op name and fails the WRITE_OPS-subset-of-enum check.
        "launch_agent",
        // ⚠ `end_agent` AND `rename_agent` WRITE (2026-09-01). Each files a
        // `channel_launch_directives` row of a non-launch KIND and asks a machine to
        // act on a running agent; a read-only token must be refused both, or a
        // `dopl.read` session can STOP its operator agents through a non-admin tool.
        // ⚠ CLASSIFIED AS WRITES EVEN THOUGH NEITHER CHANGES ANY ROW A READ COULD
        // SEE — an end mutates a live process and a rename mutates a local store, and
        // neither is a read that happens to wait. `direct_agent` above carries the
        // same argument.
        // ⚠ NO DOUBLE QUOTES IN THIS BLOCK: the parity harness parses this set out of
        // the SOURCE TEXT, so a quoted phrase in a comment is read as an op name.
        "end_agent",
        "rename_agent",
        // ⚠ WRITES THE CHANNEL INFO CARD (Q12, 2026-08-28). It also READS when
        // `info_card` is omitted, and it is classified as a WRITE anyway: an op that
        // can write must be refused wholesale for a read-only token, or the read arm
        // becomes the door the write arm walks through.
        "update",
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

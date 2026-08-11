"use strict";
/**
 * gating.ts — THE FOUR GATES, and the three tables they read.
 *
 * Split out of `server.ts` (§2, the layer rule) on the same seam
 * `delete-policy.ts` was: a policy has one reason to change and it is not the
 * reason a registrar changes. `delete-policy.ts` stayed its own module because
 * BOTH halves of §2b (the refusal and the advertised description) had to agree;
 * this module is the other half of that story — the gates that CONSUME it,
 * together with the tables that are theirs alone.
 *
 * THE TOPOLOGY IS THE INVARIANT, and it did not move with the code.
 * TWO gates run at REGISTRATION (the tool never exists) and TWO run per CALL
 * (the op is refused):
 *
 *   registration → {@link Gates.isSuppressedTool}: HIDDEN_TOOLS (D2 retirement)
 *                  and, for a read-only session, READ_ONLY_BLOCKED_TOOLS.
 *   per call     → {@link Gates.opRefusal}: §2b's app-only-deletion block
 *                  FIRST and unconditionally, then the write-scope gate.
 *
 * They live HERE, hoisted out of the registration wrapper, because
 * `registerMetaTool` registers straight onto the SDK server and so published
 * two tools that passed through none of them when the gating was inline. That
 * was inert — neither meta-tool is hidden, blocked, or carries an `op` — but
 * inert was a property of today's two tools, not of the path. Do NOT push these
 * back inside a wrapper; both registration helpers call them explicitly.
 *
 * ORDERING INSIDE `opRefusal` IS LOAD-BEARING. The delete refusal fires first
 * and unconditionally, before workspace resolution and before any client call,
 * so a refused delete costs zero round trips and can never half-happen. It must
 * not become reachable only after some other gate happens to let the call
 * through.
 *
 * `parity.test.ts` / `delete-block.test.ts` PARSE `WRITE_OPS`,
 * `READ_ONLY_BLOCKED_TOOLS` and `HIDDEN_TOOLS` out of this file's source text
 * (see `tools/parity-harness.ts`), so the suites check the REAL tables. The
 * parse follows the constant, not the filename — same note `delete-policy.ts`
 * carries.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WRITE_OPS = exports.READ_ONLY_BLOCKED_TOOLS = exports.HIDDEN_TOOLS = void 0;
exports.createGates = createGates;
const delete_policy_js_1 = require("./delete-policy.js");
/**
 * THE HIDE-BEFORE-DELETE SEAM — a registered tool an agent no longer sees.
 *
 * EMPTY, AND THAT IS THE CURRENT STATE, NOT A DEAD MECHANISM. It held four
 * names from 2026-08-07 to 2026-08-11: `dopl_workflow`, `dopl_workflow_admin`,
 * `dopl_cluster`, `dopl_cluster_admin`. Those tools have now been DELETED —
 * registrars, routes, tables and all — so there is nothing left to suppress
 * and the set is `[]`. A tool that no longer exists must not be listed here:
 * `delete-block.test.ts` asserts every HIDDEN name still has a registrar, and
 * a name with none is a claim about a gate that guards nothing.
 *
 * THE TABLE STAYS BECAUSE THE ORDER OF OPERATIONS DOES. Retiring a feature is
 * two steps — hide it, then delete it — and this is step one's whole
 * implementation. The next retirement adds its tool names here, ships, and
 * deletes the code in a later change with the surface already dark.
 *
 * WHY AT THE REGISTRAR AND NOT AT THE ROUTE. The MCP server reaches the app's
 * routes over LOOPBACK HTTP through `DoplClient`, so gating a route would kill
 * the tool by 500-ing it — the agent would still SEE the tool in `tools/list`,
 * call it, and be told the server is broken. Refusing at the registrar is the
 * honest shape: the tool never registers, so it is absent from `tools/list`
 * and there is nothing to call. Same mechanism and same choke point as
 * `READ_ONLY_BLOCKED_TOOLS`, one table below it.
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
 * Per-op write gating for the MIXED read+write tools (these stay registered
 * for read-only sessions so reads still work, but their write ops are
 * refused). Closes the gap where a `dopl.read`-only token could still write
 * via a non-admin tool. Inert while every active token carries `dopl.write`
 * — defense-in-depth for when read-only tokens are issued. Keep each set in
 * sync with the tool's `op` enum; a new write op must be added here.
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
        // P0-3 / DECISION 2 (2026-08-04). `milestone` writes a message and
        // `propose_close` writes one too (the marked prompt), so both are writes.
        // `close_thread` STAYS in this set even though the registrar now answers it
        // with a refusal: a read-only token must be refused for the SCOPE reason
        // before it is refused for the human-lane reason, or the shape of the two
        // errors tells a read-only caller which threads exist.
        "milestone",
        "create_thread",
        "propose_close",
        "close_thread",
        "set_thread_mode",
        // The multiplayer writes — `summon_agent` / `rename_agent` /
        // `set_agent_status` / `disengage_agent` / `join_thread` / `leave_thread`
        // — were listed here and are gone with the ops (channels rollback §1).
        // Unlike `close_thread` above they are NOT kept: `close_thread` is still
        // in the enum for a teaching refusal, so a read-only token must be
        // refused for the SCOPE reason first; these are not ops at all.
    ]),
};
/**
 * Build the gates for one session.
 *
 * `canWrite` is the OAuth scope verdict and it FAILS CLOSED upstream: a
 * session gets write/admin capability only if it presents a scope set that
 * explicitly includes `dopl.write`.
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

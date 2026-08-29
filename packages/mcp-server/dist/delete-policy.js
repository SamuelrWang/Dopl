"use strict";
/**
 * ⚠ DELETION IS APP-ONLY. Agents cannot delete anything over MCP: deleting in
 * the app is PERMANENT behind an "are you sure", and an MCP delete has no
 * dialog by nature — no human in the loop at the moment the row goes. Refuse,
 * do not delete-and-hope.
 *
 * ⚠ ONE CHOKE POINT, TWO MECHANISMS:
 *   1. {@link DELETE_BLOCKED_OPS} enumerates today's delete ops verbatim off
 *      each tool's `op` enum — explicit is checkable, and `parity.test.ts` /
 *      `delete-block.test.ts` cross-check it against the real enums.
 *   2. {@link DELETE_OP_SHAPE} is the FAIL-CLOSED fallback: any op on an
 *      `*_admin` tool whose name reads as a deletion is refused even if nobody
 *      added it to the table.
 *
 * ⚠ The refusal fires in the registration wrapper BEFORE workspace resolution
 * and before any client call, so a refused delete costs zero round trips and
 * can never half-happen.
 *
 * ⚠ Its own module because the policy has two halves that must agree — the
 * refusal, and the description each `_admin` tool ADVERTISES via
 * {@link deleteAdminDescription}. `server.ts` imports those registrars, so
 * parking the policy there is an import cycle.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELETE_REFUSAL = exports.DELETE_OP_SHAPE = exports.DELETE_BLOCKED_OPS = void 0;
exports.isBlockedDeleteOp = isBlockedDeleteOp;
exports.deleteAdminDescription = deleteAdminDescription;
/** The delete ops each live `_admin` tool publishes, read off its `op` enum. */
exports.DELETE_BLOCKED_OPS = {
    dopl_kb_admin: new Set(["delete_base", "delete_folder", "delete_file"]),
    dopl_skill_admin: new Set(["delete"]),
    dopl_chats_admin: new Set(["delete", "delete_folder"]),
    dopl_ontology_admin: new Set(["delete_object", "delete_cluster"]),
    dopl_agent_admin: new Set(["delete"]),
    // ⚠ A tool with no registrar needs no row — `delete-block.test.ts` pins this
    // map against the live registrar list, so a stale row fails.
};
/** An op name that reads as a deletion. The fail-closed half of the rule. */
exports.DELETE_OP_SHAPE = /^(delete|destroy|purge|trash|remove)(_|$)/;
/** True when `op` on `tool` deletes something the agent may not delete. */
function isBlockedDeleteOp(tool, op) {
    if (exports.DELETE_BLOCKED_OPS[tool]?.has(op))
        return true;
    return tool.endsWith("_admin") && exports.DELETE_OP_SHAPE.test(op);
}
/**
 * ⚠ THE one refusal, worded once: states the rule, names where the user CAN do
 * it, and closes the retry loop — an agent told only "no" tries
 * op="delete_file" after op="delete_base".
 */
exports.DELETE_REFUSAL = `Deletion is app-only. Ask the user to delete this in the Dopl app. Agents cannot delete over MCP — no role, scope or argument changes that, so do not retry this with different parameters. Editing and rewriting are still available to you (dopl_kb op="write_file", dopl_skill op="write", dopl_ontology's update ops).`;
/**
 * Build an `_admin` tool's description: shared refusal preamble, the ops it
 * publishes only to refuse, and the domain's alternatives paragraph.
 *
 * ⚠ Built here, never hand-copied into the registrars — a copied preamble puts
 * the policy an agent READS a copy-paste away from the one the server ENFORCES.
 * `parity.test.ts` asserts every admin description opens with the refusal.
 *
 * ⚠ The ops stay LISTED rather than vanishing with the tool: an absent tool
 * reads as a broken connection and gets retried, where a refusal naming the app
 * is acted on.
 */
function deleteAdminDescription(refusedOps, alternatives) {
    const many = refusedOps.length > 1;
    const preamble = `Deletion is app-only: calling any op here is REFUSED and removes nothing. Deleting happens in the Dopl app, where it carries a confirmation step and is permanent — there is no MCP path to it, for any role or token. The ${many ? "ops stay" : "op stays"} listed so the refusal is discoverable — an absent tool would read as a broken connection and be retried. Refused ${many ? "ops" : "op"}:`;
    return [
        preamble,
        ...refusedOps.map(({ op, effect }) => `- "${op}" — ${effect}. Refused.`),
        "",
        alternatives,
    ].join("\n");
}

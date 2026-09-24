"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteRefusal = exports.DELETE_OP_SHAPE = exports.DELETE_BLOCKED_OPS = void 0;
exports.isBlockedDeleteOp = isBlockedDeleteOp;
const call_ref_js_1 = require("./call-ref.js");
const tool_errors_js_1 = require("./tools/tool-errors.js");
/**
 * Deletion is app-only: no op deletes anything over MCP (app DELETE routes are `sessionOnly`).
 * Parsed as source text by `parity-harness.ts › DELETE_POLICY_SOURCE` and
 * `src/shared/auth/app-only-delete-gate.test.ts` — keep the declarations' shape.
 */
/** App-owned delete ops by domain tool; each must stay out of its tool's `op` enum. */
exports.DELETE_BLOCKED_OPS = {
    dopl_kb: new Set(["delete_base", "delete_folder", "delete_file"]),
    dopl_skill: new Set(["delete"]),
    dopl_chats: new Set(["delete", "delete_folder"]),
    dopl_ontology: new Set(["delete_object", "delete_ontology"]),
    dopl_agent: new Set(["delete"]),
};
exports.DELETE_OP_SHAPE = /^(delete|destroy|purge|trash|remove)(_|$)/;
/** The name-shape fallback stays `*_admin`-only: `dopl_ontology`'s `remove_*` ops edit, not delete. */
function isBlockedDeleteOp(tool, op) {
    if (exports.DELETE_BLOCKED_OPS[tool]?.has(op))
        return true;
    return tool.endsWith("_admin") && exports.DELETE_OP_SHAPE.test(op);
}
/**
 * The one refusal: states the rule, names where the user can act, and closes the retry loop. The
 * rewrite tools it names are the connection's set's.
 */
const deleteRefusal = () => (0, tool_errors_js_1.refusal)(tool_errors_js_1.DELETE_IS_APP_ONLY, 
// First sentence pinned verbatim by `retirement.test.ts`, in both sets.
`Deletion is app-only. Ask the user to delete this in the Dopl app. No role, scope or argument changes that, so do not retry with different parameters. Editing and rewriting are still available to you (${(0, call_ref_js_1.callRef)("kb.write_file", {}, { form: "named" })}, ${(0, call_ref_js_1.callRef)("skill.write", {}, { form: "named" })}, ${(0, call_ref_js_1.bySet)({ legacy: "dopl_ontology's update ops", granular: (0, call_ref_js_1.callRef)("ontology.update_object") })}).`);
exports.deleteRefusal = deleteRefusal;

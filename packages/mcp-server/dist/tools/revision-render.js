"use strict";
/**
 * HISTORY + RESTORE, the parts `dopl_kb`, `dopl_skill` and `dopl_ontology` share: one row
 * renderer, one restore-error mapper, and the two codes a restore refusal leads with — so the
 * three tools cannot describe one failure three ways.
 *
 * ⚠ A RESTORE DESTROYS NOTHING: it writes an old snapshot back as a NEW revision, and the source
 * row stays. That is why the routes are agent-reachable (not `sessionOnly`); the server's write
 * gates still apply, and every restore here carries the caller's `expected_version`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HISTORY_OP = exports.HISTORY_PAGE_DEFAULT = void 0;
exports.revisionNotFound = revisionNotFound;
exports.foreignRevision = foreignRevision;
exports.revisionRow = revisionRow;
exports.pageTail = pageTail;
exports.restoreRefusal = restoreRefusal;
exports.staleBeforeRestore = staleBeforeRestore;
const narration_js_1 = require("./narration.js");
const respond_js_1 = require("./respond.js");
const tool_errors_js_1 = require("./tool-errors.js");
/** Emit-only: 404 `REVISION_NOT_FOUND` (unknown id, another item's revision, or unreadable). */
function revisionNotFound(historyOp) {
    return {
        reason: "revision_not_found",
        meaning: "no revision by that id on this item, or none you can read; nothing changed",
        retry: historyOp,
    };
}
/** Emit-only: 409 `REVISION_NOT_RESTORABLE` — a move, a link, or a create/delete bundle. */
const REVISION_NOT_RESTORABLE = {
    reason: "revision_not_restorable",
    meaning: "that revision holds nothing to write back (a move, a link, or a create/delete bundle); nothing changed",
    retry: "pick another revision",
};
/** Default rows per history page; the server's own page cap bounds `limit`. */
exports.HISTORY_PAGE_DEFAULT = 20;
/** The op every history refusal points back to. */
exports.HISTORY_OP = 'op="history"';
/** Who wrote a row, relative to the caller. ⚠ Never a name: an id is the only unforgeable handle. */
function actorLabel(rev, callerUserId) {
    if (rev.actor.userId && rev.actor.userId === callerUserId) {
        return rev.actor.kind === "agent" ? "your agent" : "you";
    }
    return rev.actor.kind === "agent" ? "a member's agent" : "a member";
}
/** True when the snapshot was written by someone other than the caller — its body is fenced. */
function foreignRevision(rev, callerUserId) {
    return !callerUserId || rev.actor.userId !== callerUserId;
}
/** One history row: id first (the handle), then what happened, when, by whom. */
function revisionRow(rev, callerUserId, extra = "") {
    const summary = rev.summary ? ` · ${(0, narration_js_1.inlineOr)(rev.summary, "")}` : "";
    return `- \`${rev.id}\` · ${rev.op} · ${rev.createdAt} · by ${actorLabel(rev, callerUserId)}${extra}${summary}`;
}
/** The paging tail: the next cursor verbatim, or an explicit end. */
function pageTail(nextCursor, cursorArg) {
    return nextCursor ? `More: ${cursorArg}="${nextCursor}"` : "End of history.";
}
/**
 * Map a restore failure to a named refusal, or null (rethrow). `readOp` is the call that yields
 * a fresh Version; `historyOp` the one that lists revisions.
 */
function restoreRefusal(e, readOp, historyOp) {
    if ((0, respond_js_1.isConflict)(e)) {
        return (0, respond_js_1.err)((0, tool_errors_js_1.refusal)((0, tool_errors_js_1.versionConflict)(readOp), "NOTHING was restored. Somebody wrote after the Version you passed — read the current state, confirm the restore still makes sense, then re-issue with the new expected_version."));
    }
    const code = (0, respond_js_1.apiErrorCode)(e);
    if (code === "REVISION_NOT_FOUND")
        return (0, respond_js_1.err)((0, tool_errors_js_1.refusal)(revisionNotFound(historyOp)));
    if (code === "REVISION_NOT_RESTORABLE")
        return (0, respond_js_1.err)((0, tool_errors_js_1.refusal)(REVISION_NOT_RESTORABLE));
    return null;
}
/** Refused before any write: the Version the caller holds is not the current one. */
function staleBeforeRestore(readOp, current, passed) {
    return (0, respond_js_1.err)((0, tool_errors_js_1.refusal)((0, tool_errors_js_1.versionConflict)(readOp), `NOTHING was restored. You passed expected_version=${(0, narration_js_1.inlineOr)(passed, "`(empty)`")} but the current Version is \`${current}\` — something changed since your read. Re-read, confirm, then re-issue with the current Version.`));
}

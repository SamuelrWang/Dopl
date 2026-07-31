"use strict";
/**
 * Shared render helpers + graph types for the `dopl_workflow` tool. The
 * read and write op modules both lean on these; the registrar
 * (workflow.ts) keeps op routing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_TITLE = exports.NO_NAME = void 0;
exports.plural = plural;
exports.renderReads = renderReads;
exports.renderActions = renderActions;
exports.workflowNotFound = workflowNotFound;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
/**
 * A workflow's `name` / `description`, and every step's `title`, are typed by
 * a workspace member and bounded by length alone (max 120 / 2000 / 200,
 * app/api/workflows). The STEP INSTRUCTIONS — `description`, `userInput`,
 * `agentOutput`, `nextInstructions` — are the workflow's whole point: prose
 * written for the agent to follow. Those stay intact; names and titles, which
 * were spliced into `# `, `### ` and bullet heads, become values.
 */
exports.NO_NAME = "`(unnamed)`";
exports.NO_TITLE = "`(untitled)`";
function plural(n, noun) {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
function renderReads(reads) {
    return reads
        .map((r) => r.kind === "file"
        ? `${(0, narration_1.inlineOr)(r.name, exports.NO_NAME)} (file, kb_id: ${r.kbId}, entry_id: ${r.entryId})`
        : `${(0, narration_1.inlineOr)(r.name, exports.NO_NAME)} (knowledge base, kb_id: ${r.kbId})`)
        .join("; ");
}
function renderActions(actions) {
    return actions
        .map((a) => `${(0, narration_1.inlineOr)(a.name, exports.NO_NAME)} (skill, skill_id: ${a.skillId})`)
        .join("; ");
}
/**
 * Clean "no such workflow" guidance for a backend 404 on a slug-addressed
 * op — mirrors the isNotFound mapping opDisconnect / dopl_cluster_admin use,
 * so authors get a recoverable message instead of a raw "HTTP 404: {json}".
 */
function workflowNotFound(slug) {
    return (0, respond_1.err)(`No workflow \`${slug}\` in this workspace. Run dopl_workflow(op="list") to see valid slugs/ids.`);
}

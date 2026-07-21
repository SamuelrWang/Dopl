"use strict";
/**
 * Shared render helpers + graph types for the `dopl_workflow` tool. The
 * read and write op modules both lean on these; the registrar
 * (workflow.ts) keeps op routing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plural = plural;
exports.renderReads = renderReads;
exports.renderActions = renderActions;
exports.workflowNotFound = workflowNotFound;
const respond_1 = require("./respond");
function plural(n, noun) {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
function renderReads(reads) {
    return reads
        .map((r) => r.kind === "file"
        ? `${r.name} (file, kb_id: ${r.kbId}, entry_id: ${r.entryId})`
        : `${r.name} (knowledge base, kb_id: ${r.kbId})`)
        .join("; ");
}
function renderActions(actions) {
    return actions.map((a) => `${a.name} (skill, skill_id: ${a.skillId})`).join("; ");
}
/**
 * Clean "no such workflow" guidance for a backend 404 on a slug-addressed
 * op — mirrors the isNotFound mapping opDisconnect / dopl_cluster_admin use,
 * so authors get a recoverable message instead of a raw "HTTP 404: {json}".
 */
function workflowNotFound(slug) {
    return (0, respond_1.err)(`No workflow \`${slug}\` in this workspace. Run dopl_workflow(op="list") to see valid slugs/ids.`);
}

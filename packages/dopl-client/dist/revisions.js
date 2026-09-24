"use strict";
/**
 * HISTORY + RESTORE for durable content: knowledge entries, skills and
 * ontology objects. Every route here already existed for the app's Changelog panels and is
 * agent-reachable by design (a restore APPENDS a revision and destroys nothing, so none is
 * `sessionOnly`); the server's write gates — `assertBaseWritable` / `agent_write_enabled`, the
 * skill toggle, the ontology share level — are what fence an agent.
 *
 * ⚠ EVERY RESTORE TAKES `expectedVersion`, sent as `X-Updated-At` — the same precondition the
 * write routes take, so a restore over a newer edit is a 412 rather than a silent clobber.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listKbEntryRevisions = listKbEntryRevisions;
exports.restoreKbEntryRevision = restoreKbEntryRevision;
exports.getSkillHistory = getSkillHistory;
exports.getSkillVersion = getSkillVersion;
exports.restoreSkillVersion = restoreSkillVersion;
exports.listOntologyObjectRevisions = listOntologyObjectRevisions;
exports.listOntologyRevisions = listOntologyRevisions;
exports.restoreOntologyObjectRevision = restoreOntologyObjectRevision;
const enc = encodeURIComponent;
function pageQuery(opts) {
    const params = new URLSearchParams();
    if (opts.cursor)
        params.set("cursor", opts.cursor);
    if (opts.limit !== undefined)
        params.set("limit", String(opts.limit));
    const qs = params.toString();
    return qs ? `?${qs}` : "";
}
function precondition(expectedVersion) {
    return { "X-Updated-At": expectedVersion };
}
// ─── Knowledge entries ──────────────────────────────────────────────
async function listKbEntryRevisions(t, entryId, opts = {}) {
    return t.request(`/api/knowledge/entries/${enc(entryId)}/revisions${pageQuery(opts)}`, { toolName: "kb_history" });
}
async function restoreKbEntryRevision(t, entryId, revisionId, expectedVersion) {
    const data = await t.request(`/api/knowledge/entries/${enc(entryId)}/revisions/${enc(revisionId)}/restore`, { method: "POST", toolName: "kb_restore", customHeaders: precondition(expectedVersion) });
    return data.entry;
}
// ─── Skills ─────────────────────────────────────────────────────────
async function getSkillHistory(t, slug, opts = {}) {
    return t.request(`/api/skills/${enc(slug)}/history${pageQuery({ limit: opts.limit })}`, {
        toolName: "skill_history",
    });
}
async function getSkillVersion(t, versionId) {
    const data = await t.request(`/api/skills/versions/${enc(versionId)}`, { toolName: "skill_history" });
    return data.version;
}
async function restoreSkillVersion(t, versionId, expectedVersion) {
    const data = await t.request(`/api/skills/versions/${enc(versionId)}/restore`, { method: "POST", toolName: "skill_restore", customHeaders: precondition(expectedVersion) });
    return data.file;
}
// ─── Ontology ───────────────────────────────────────────────────────
async function listOntologyObjectRevisions(t, objectId, opts = {}) {
    return t.request(`/api/ontology/objects/${enc(objectId)}/revisions${pageQuery(opts)}`, { toolName: "ontology_history" });
}
async function listOntologyRevisions(t, ontologyId, opts = {}) {
    return t.request(`/api/ontology/ontologies/${enc(ontologyId)}/revisions${pageQuery(opts)}`, { toolName: "ontology_history" });
}
async function restoreOntologyObjectRevision(t, objectId, revisionId, expectedVersion) {
    const data = await t.request(`/api/ontology/objects/${enc(objectId)}/revisions/${enc(revisionId)}/restore`, { method: "POST", toolName: "ontology_restore", customHeaders: precondition(expectedVersion) });
    return data.object;
}

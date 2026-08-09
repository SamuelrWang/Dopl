"use strict";
/**
 * Ontology methods for `DoplClient` — reads plus the full authoring
 * surface, so an agent can build ontologies without the web UI.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOntology = getOntology;
exports.getOntologySummary = getOntologySummary;
exports.getOntologyAnchor = getOntologyAnchor;
exports.createOntologyCluster = createOntologyCluster;
exports.updateOntologyCluster = updateOntologyCluster;
exports.deleteOntologyCluster = deleteOntologyCluster;
exports.createOntologyObject = createOntologyObject;
exports.updateOntologyObject = updateOntologyObject;
exports.deleteOntologyObject = deleteOntologyObject;
exports.claimOntologyAnchor = claimOntologyAnchor;
const enc = encodeURIComponent;
async function getOntology(t) {
    return t.request("/api/ontology", {
        toolName: "ontology_snapshot",
    });
}
/**
 * The cheap projection of the same endpoint — names and containment, no JSONB.
 * See {@link OntologySummary} for what it drops and why. Distinct `toolName` so
 * the two reads are separable in the `mcp_tool_calls` telemetry that the
 * payload work is judged on.
 */
async function getOntologySummary(t) {
    return t.request("/api/ontology?view=summary", {
        toolName: "ontology_summary",
    });
}
async function getOntologyAnchor(t) {
    const data = await t.request("/api/ontology/anchor", { toolName: "ontology_anchor" });
    return data.object;
}
async function createOntologyCluster(t, input) {
    const data = await t.request("/api/ontology/clusters", { toolName: "ontology_create_cluster", method: "POST", body: input });
    return data.cluster;
}
async function updateOntologyCluster(t, clusterId, patch) {
    const data = await t.request(`/api/ontology/clusters/${enc(clusterId)}`, { toolName: "ontology_update_cluster", method: "PATCH", body: patch });
    return data.cluster;
}
async function deleteOntologyCluster(t, clusterId) {
    // The route replies 204 No Content — request<T>() would choke on the
    // empty body ("Unexpected end of JSON input") AFTER the delete applied.
    await t.requestNoContent(`/api/ontology/clusters/${enc(clusterId)}`, "DELETE", "ontology_delete_cluster");
}
async function createOntologyObject(t, input) {
    const data = await t.request("/api/ontology/objects", { toolName: "ontology_create_object", method: "POST", body: input });
    return data.object;
}
async function updateOntologyObject(t, objectId, patch, expectedVersion) {
    // Optional optimistic-concurrency precondition. When the caller passes a
    // version (an object's `updatedAt` from a prior read), it rides as the
    // `X-Updated-At` header — the same wire convention KB/skills writes use —
    // and the server rejects the PATCH with 412 if the row moved since. Omit
    // it to keep the legacy last-writer-wins behaviour.
    const data = await t.request(`/api/ontology/objects/${enc(objectId)}`, {
        toolName: "ontology_update_object",
        method: "PATCH",
        body: patch,
        customHeaders: expectedVersion ? { "X-Updated-At": expectedVersion } : undefined,
    });
    return data.object;
}
async function deleteOntologyObject(t, objectId) {
    // 204 route — see deleteOntologyCluster.
    await t.requestNoContent(`/api/ontology/objects/${enc(objectId)}`, "DELETE", "ontology_delete_object");
}
async function claimOntologyAnchor(t, objectId) {
    const data = await t.request(`/api/ontology/objects/${enc(objectId)}/anchor`, { toolName: "ontology_claim_anchor", method: "POST", body: {} });
    return data.object;
}

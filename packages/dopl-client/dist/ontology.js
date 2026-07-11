"use strict";
/**
 * Ontology methods for `DoplClient` — reads plus the full authoring
 * surface, so an agent can build ontologies without the web UI.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOntology = getOntology;
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
async function updateOntologyObject(t, objectId, patch) {
    const data = await t.request(`/api/ontology/objects/${enc(objectId)}`, { toolName: "ontology_update_object", method: "PATCH", body: patch });
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

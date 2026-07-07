"use strict";
/**
 * Ontology methods for `DoplClient`. Read-only for now — the ontology
 * is edited in the web UI; agents consume it as a routing layer.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOntology = getOntology;
exports.getOntologyAnchor = getOntologyAnchor;
async function getOntology(t) {
    return t.request("/api/ontology", {
        toolName: "ontology_snapshot",
    });
}
async function getOntologyAnchor(t) {
    const data = await t.request("/api/ontology/anchor", { toolName: "ontology_anchor" });
    return data.object;
}

/**
 * Ontology method group — link 4 of the chain in `client-base.ts`. Pure
 * delegation to `ontology.ts`; no HTTP here.
 */
import { KnowledgeMethods } from "./client-knowledge.js";
import type { OntologyCluster, OntologyClusterCreateInput, OntologyClusterPatch, OntologyObject, OntologyObjectCreateInput, OntologyObjectPatch, OntologySnapshot, OntologySummary } from "./ontology-types.js";
export declare class OntologyMethods extends KnowledgeMethods {
    /**
     * The workspace ontology. `{ view: "summary" }` = cheap projection (names and
     * containment, no JSONB) for renders that only route; omit or `"full"` for
     * the whole graph.
     *
     * ⚠ An OPTIONAL ARGUMENT, not a second method: every hand-stubbed client in
     * the MCP server's suite stubs `getOntology` with a zero-arg fake cast
     * through `as unknown as DoplClient`, so a rename breaks them at runtime
     * while type-checking cleanly.
     */
    getOntology(): Promise<OntologySnapshot>;
    getOntology(opts: {
        view: "full";
    }): Promise<OntologySnapshot>;
    getOntology(opts: {
        view: "summary";
    }): Promise<OntologySummary>;
    getOntologyAnchor(): Promise<OntologyObject | null>;
    createOntologyCluster(input: OntologyClusterCreateInput): Promise<OntologyCluster>;
    updateOntologyCluster(clusterId: string, patch: OntologyClusterPatch): Promise<OntologyCluster>;
    deleteOntologyCluster(clusterId: string): Promise<void>;
    createOntologyObject(input: OntologyObjectCreateInput): Promise<OntologyObject>;
    updateOntologyObject(objectId: string, patch: OntologyObjectPatch, expectedVersion?: string): Promise<OntologyObject>;
    deleteOntologyObject(objectId: string): Promise<void>;
    claimOntologyAnchor(objectId: string): Promise<OntologyObject>;
}

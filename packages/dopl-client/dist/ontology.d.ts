/**
 * Ontology methods for `DoplClient` — reads plus the full authoring
 * surface, so an agent can build ontologies without the web UI.
 */
import type { DoplTransport } from "./transport.js";
import type { OntologyCluster, OntologyClusterCreateInput, OntologyClusterPatch, OntologyObject, OntologyObjectCreateInput, OntologyObjectPatch, OntologySnapshot, OntologySummary } from "./ontology-types.js";
export declare function getOntology(t: DoplTransport): Promise<OntologySnapshot>;
/**
 * The cheap projection of the same endpoint — names and containment, no JSONB.
 * See {@link OntologySummary} for what it drops and why. Distinct `toolName` so
 * the two reads are separable in the `mcp_tool_calls` telemetry that the
 * payload work is judged on.
 */
export declare function getOntologySummary(t: DoplTransport): Promise<OntologySummary>;
export declare function getOntologyAnchor(t: DoplTransport): Promise<OntologyObject | null>;
export declare function createOntologyCluster(t: DoplTransport, input: OntologyClusterCreateInput): Promise<OntologyCluster>;
export declare function updateOntologyCluster(t: DoplTransport, clusterId: string, patch: OntologyClusterPatch): Promise<OntologyCluster>;
export declare function deleteOntologyCluster(t: DoplTransport, clusterId: string): Promise<void>;
export declare function createOntologyObject(t: DoplTransport, input: OntologyObjectCreateInput): Promise<OntologyObject>;
export declare function updateOntologyObject(t: DoplTransport, objectId: string, patch: OntologyObjectPatch, expectedVersion?: string): Promise<OntologyObject>;
export declare function deleteOntologyObject(t: DoplTransport, objectId: string): Promise<void>;
export declare function claimOntologyAnchor(t: DoplTransport, objectId: string): Promise<OntologyObject>;

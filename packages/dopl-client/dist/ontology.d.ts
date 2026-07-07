/**
 * Ontology methods for `DoplClient` — reads plus the full authoring
 * surface, so an agent can build ontologies without the web UI.
 */
import type { DoplTransport } from "./transport.js";
import type { OntologyCluster, OntologyClusterCreateInput, OntologyClusterPatch, OntologyObject, OntologyObjectCreateInput, OntologyObjectPatch, OntologySnapshot } from "./ontology-types.js";
export declare function getOntology(t: DoplTransport): Promise<OntologySnapshot>;
export declare function getOntologyAnchor(t: DoplTransport): Promise<OntologyObject | null>;
export declare function createOntologyCluster(t: DoplTransport, input: OntologyClusterCreateInput): Promise<OntologyCluster>;
export declare function updateOntologyCluster(t: DoplTransport, clusterId: string, patch: OntologyClusterPatch): Promise<OntologyCluster>;
export declare function deleteOntologyCluster(t: DoplTransport, clusterId: string): Promise<void>;
export declare function createOntologyObject(t: DoplTransport, input: OntologyObjectCreateInput): Promise<OntologyObject>;
export declare function updateOntologyObject(t: DoplTransport, objectId: string, patch: OntologyObjectPatch): Promise<OntologyObject>;
export declare function deleteOntologyObject(t: DoplTransport, objectId: string): Promise<void>;
export declare function claimOntologyAnchor(t: DoplTransport, objectId: string): Promise<OntologyObject>;

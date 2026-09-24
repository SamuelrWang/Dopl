/**
 * Ontology methods for `DoplClient` — reads plus the full authoring surface, so
 * an agent can build ontologies without the web UI.
 */
import type { DoplTransport } from "./transport.js";
import type { Ontology, OntologyCreateInput, OntologyPatch, OntologyObject, OntologyObjectCreateInput, OntologyObjectPatch, OntologySnapshot, OntologySummary } from "./ontology-types.js";
export declare function getOntology(t: DoplTransport): Promise<OntologySnapshot>;
/**
 * Cheap projection of the same endpoint — names and containment, no JSONB. See
 * {@link OntologySummary}. Distinct `toolName` so the two reads stay separable
 * in `mcp_tool_calls` telemetry.
 */
export declare function getOntologySummary(t: DoplTransport): Promise<OntologySummary>;
export declare function getOntologyAnchor(t: DoplTransport): Promise<OntologyObject | null>;
export declare function createOntology(t: DoplTransport, input: OntologyCreateInput): Promise<Ontology>;
export declare function updateOntology(t: DoplTransport, ontologyId: string, patch: OntologyPatch): Promise<Ontology>;
export declare function deleteOntology(t: DoplTransport, ontologyId: string): Promise<void>;
export declare function createOntologyObject(t: DoplTransport, input: OntologyObjectCreateInput): Promise<OntologyObject>;
export declare function updateOntologyObject(t: DoplTransport, objectId: string, patch: OntologyObjectPatch, expectedVersion?: string): Promise<OntologyObject>;
export declare function deleteOntologyObject(t: DoplTransport, objectId: string): Promise<void>;
export declare function claimOntologyAnchor(t: DoplTransport, objectId: string): Promise<OntologyObject>;

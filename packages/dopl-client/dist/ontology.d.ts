/**
 * Ontology methods for `DoplClient`. Read-only for now — the ontology
 * is edited in the web UI; agents consume it as a routing layer.
 */
import type { DoplTransport } from "./transport.js";
import type { OntologyObject, OntologySnapshot } from "./ontology-types.js";
export declare function getOntology(t: DoplTransport): Promise<OntologySnapshot>;
export declare function getOntologyAnchor(t: DoplTransport): Promise<OntologyObject | null>;

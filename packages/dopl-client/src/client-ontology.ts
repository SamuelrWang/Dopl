/**
 * Ontology method group — link 4 of the chain in `client-base.ts`. Pure
 * delegation to `ontology.ts`; no HTTP here.
 */

import { KnowledgeMethods } from "./client-knowledge.js";
import * as ontology from "./ontology.js";
import type {
  Ontology,
  OntologyCreateInput,
  OntologyPatch,
  OntologyObject,
  OntologyObjectCreateInput,
  OntologyObjectPatch,
  OntologySnapshot,
  OntologySummary,
} from "./ontology-types.js";

export class OntologyMethods extends KnowledgeMethods {
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
  getOntology(opts: { view: "full" }): Promise<OntologySnapshot>;
  getOntology(opts: { view: "summary" }): Promise<OntologySummary>;
  getOntology(
    opts?: { view?: "full" | "summary" }
  ): Promise<OntologySnapshot | OntologySummary> {
    return opts?.view === "summary"
      ? ontology.getOntologySummary(this.transport)
      : ontology.getOntology(this.transport);
  }

  getOntologyAnchor(): Promise<OntologyObject | null> {
    return ontology.getOntologyAnchor(this.transport);
  }

  createOntology(input: OntologyCreateInput): Promise<Ontology> {
    return ontology.createOntology(this.transport, input);
  }

  updateOntology(ontologyId: string, patch: OntologyPatch): Promise<Ontology> {
    return ontology.updateOntology(this.transport, ontologyId, patch);
  }

  deleteOntology(ontologyId: string): Promise<void> {
    return ontology.deleteOntology(this.transport, ontologyId);
  }

  createOntologyObject(input: OntologyObjectCreateInput): Promise<OntologyObject> {
    return ontology.createOntologyObject(this.transport, input);
  }

  updateOntologyObject(
    objectId: string,
    patch: OntologyObjectPatch,
    expectedVersion?: string
  ): Promise<OntologyObject> {
    return ontology.updateOntologyObject(this.transport, objectId, patch, expectedVersion);
  }

  deleteOntologyObject(objectId: string): Promise<void> {
    return ontology.deleteOntologyObject(this.transport, objectId);
  }

  claimOntologyAnchor(objectId: string): Promise<OntologyObject> {
    return ontology.claimOntologyAnchor(this.transport, objectId);
  }
}

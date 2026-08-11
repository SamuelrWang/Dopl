/**
 * Ontology method group — link 4 of the chain documented in `client-base.ts`.
 * Pure delegation to `ontology.ts`; no HTTP here.
 */

import { KnowledgeMethods } from "./client-knowledge.js";
import * as ontology from "./ontology.js";
import type {
  OntologyCluster,
  OntologyClusterCreateInput,
  OntologyClusterPatch,
  OntologyObject,
  OntologyObjectCreateInput,
  OntologyObjectPatch,
  OntologySnapshot,
  OntologySummary,
} from "./ontology-types.js";

export class OntologyMethods extends KnowledgeMethods {
  /**
   * The workspace ontology. `{ view: "summary" }` asks for the cheap
   * projection — names and containment, none of the JSONB — for renders that
   * only route. Omit it (or pass `"full"`) for the whole graph.
   *
   * An OPTIONAL ARGUMENT on the existing method rather than a second method:
   * the resource is the same and the wire call is the same, and every
   * hand-stubbed client in the MCP server's suite stubs `getOntology` with a
   * zero-arg fake — a rename would have broken all of them at runtime while
   * type-checking cleanly, since they cast through `as unknown as DoplClient`.
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

  createOntologyCluster(input: OntologyClusterCreateInput): Promise<OntologyCluster> {
    return ontology.createOntologyCluster(this.transport, input);
  }

  updateOntologyCluster(clusterId: string, patch: OntologyClusterPatch): Promise<OntologyCluster> {
    return ontology.updateOntologyCluster(this.transport, clusterId, patch);
  }

  deleteOntologyCluster(clusterId: string): Promise<void> {
    return ontology.deleteOntologyCluster(this.transport, clusterId);
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

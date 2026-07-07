/**
 * Ontology methods for `DoplClient`. Read-only for now — the ontology
 * is edited in the web UI; agents consume it as a routing layer.
 */

import type { DoplTransport } from "./transport.js";
import type { OntologyObject, OntologySnapshot } from "./ontology-types.js";

export async function getOntology(t: DoplTransport): Promise<OntologySnapshot> {
  return t.request<OntologySnapshot>("/api/ontology", {
    toolName: "ontology_snapshot",
  });
}

export async function getOntologyAnchor(
  t: DoplTransport
): Promise<OntologyObject | null> {
  const data = await t.request<{ object: OntologyObject | null }>(
    "/api/ontology/anchor",
    { toolName: "ontology_anchor" }
  );
  return data.object;
}

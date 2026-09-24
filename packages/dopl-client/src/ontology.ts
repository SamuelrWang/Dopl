/**
 * Ontology methods for `DoplClient` — reads plus the full authoring surface, so
 * an agent can build ontologies without the web UI.
 */

import type { DoplTransport } from "./transport.js";
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

const enc = encodeURIComponent;

export async function getOntology(t: DoplTransport): Promise<OntologySnapshot> {
  return t.request<OntologySnapshot>("/api/ontology", {
    toolName: "ontology_snapshot",
  });
}

/**
 * Cheap projection of the same endpoint — names and containment, no JSONB. See
 * {@link OntologySummary}. Distinct `toolName` so the two reads stay separable
 * in `mcp_tool_calls` telemetry.
 */
export async function getOntologySummary(
  t: DoplTransport
): Promise<OntologySummary> {
  return t.request<OntologySummary>("/api/ontology?view=summary", {
    toolName: "ontology_summary",
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

export async function createOntology(
  t: DoplTransport,
  input: OntologyCreateInput
): Promise<Ontology> {
  const data = await t.request<{ ontology: Ontology }>(
    "/api/ontology/ontologies",
    { toolName: "ontology_create_ontology", method: "POST", body: input }
  );
  return data.ontology;
}

export async function updateOntology(
  t: DoplTransport,
  ontologyId: string,
  patch: OntologyPatch
): Promise<Ontology> {
  const data = await t.request<{ ontology: Ontology }>(
    `/api/ontology/ontologies/${enc(ontologyId)}`,
    { toolName: "ontology_update_ontology", method: "PATCH", body: patch }
  );
  return data.ontology;
}

export async function deleteOntology(
  t: DoplTransport,
  ontologyId: string
): Promise<void> {
  // ⚠ Route replies 204 — request<T>() chokes on the empty body ("Unexpected
  // end of JSON input") AFTER the delete applied.
  await t.requestNoContent(
    `/api/ontology/ontologies/${enc(ontologyId)}`,
    "DELETE",
    "ontology_delete_ontology"
  );
}

export async function createOntologyObject(
  t: DoplTransport,
  input: OntologyObjectCreateInput
): Promise<OntologyObject> {
  const data = await t.request<{ object: OntologyObject }>(
    "/api/ontology/objects",
    { toolName: "ontology_create_object", method: "POST", body: input }
  );
  return data.object;
}

export async function updateOntologyObject(
  t: DoplTransport,
  objectId: string,
  patch: OntologyObjectPatch,
  expectedVersion?: string
): Promise<OntologyObject> {
  // Optional optimistic-concurrency precondition: a version (the object's
  // `updatedAt` from a prior read) rides as `X-Updated-At` — same wire
  // convention as KB/skills writes — and the server 412s if the row moved.
  // Omitted = legacy last-writer-wins.
  const data = await t.request<{ object: OntologyObject }>(
    `/api/ontology/objects/${enc(objectId)}`,
    {
      toolName: "ontology_update_object",
      method: "PATCH",
      body: patch,
      customHeaders: expectedVersion ? { "X-Updated-At": expectedVersion } : undefined,
    }
  );
  return data.object;
}

export async function deleteOntologyObject(
  t: DoplTransport,
  objectId: string
): Promise<void> {
  // 204 route — see deleteOntology.
  await t.requestNoContent(
    `/api/ontology/objects/${enc(objectId)}`,
    "DELETE",
    "ontology_delete_object"
  );
}

export async function claimOntologyAnchor(
  t: DoplTransport,
  objectId: string
): Promise<OntologyObject> {
  const data = await t.request<{ object: OntologyObject }>(
    `/api/ontology/objects/${enc(objectId)}/anchor`,
    { toolName: "ontology_claim_anchor", method: "POST", body: {} }
  );
  return data.object;
}

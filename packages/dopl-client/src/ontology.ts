/**
 * Ontology methods for `DoplClient` — reads plus the full authoring
 * surface, so an agent can build ontologies without the web UI.
 */

import type { DoplTransport } from "./transport.js";
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

const enc = encodeURIComponent;

export async function getOntology(t: DoplTransport): Promise<OntologySnapshot> {
  return t.request<OntologySnapshot>("/api/ontology", {
    toolName: "ontology_snapshot",
  });
}

/**
 * The cheap projection of the same endpoint — names and containment, no JSONB.
 * See {@link OntologySummary} for what it drops and why. Distinct `toolName` so
 * the two reads are separable in the `mcp_tool_calls` telemetry that the
 * payload work is judged on.
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

export async function createOntologyCluster(
  t: DoplTransport,
  input: OntologyClusterCreateInput
): Promise<OntologyCluster> {
  const data = await t.request<{ cluster: OntologyCluster }>(
    "/api/ontology/clusters",
    { toolName: "ontology_create_cluster", method: "POST", body: input }
  );
  return data.cluster;
}

export async function updateOntologyCluster(
  t: DoplTransport,
  clusterId: string,
  patch: OntologyClusterPatch
): Promise<OntologyCluster> {
  const data = await t.request<{ cluster: OntologyCluster }>(
    `/api/ontology/clusters/${enc(clusterId)}`,
    { toolName: "ontology_update_cluster", method: "PATCH", body: patch }
  );
  return data.cluster;
}

export async function deleteOntologyCluster(
  t: DoplTransport,
  clusterId: string
): Promise<void> {
  // The route replies 204 No Content — request<T>() would choke on the
  // empty body ("Unexpected end of JSON input") AFTER the delete applied.
  await t.requestNoContent(
    `/api/ontology/clusters/${enc(clusterId)}`,
    "DELETE",
    "ontology_delete_cluster"
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
  // Optional optimistic-concurrency precondition. When the caller passes a
  // version (an object's `updatedAt` from a prior read), it rides as the
  // `X-Updated-At` header — the same wire convention KB/skills writes use —
  // and the server rejects the PATCH with 412 if the row moved since. Omit
  // it to keep the legacy last-writer-wins behaviour.
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
  // 204 route — see deleteOntologyCluster.
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

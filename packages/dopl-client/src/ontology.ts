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
} from "./ontology-types.js";

const enc = encodeURIComponent;

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
  await t.request<void>(`/api/ontology/clusters/${enc(clusterId)}`, {
    toolName: "ontology_delete_cluster",
    method: "DELETE",
  });
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
  patch: OntologyObjectPatch
): Promise<OntologyObject> {
  const data = await t.request<{ object: OntologyObject }>(
    `/api/ontology/objects/${enc(objectId)}`,
    { toolName: "ontology_update_object", method: "PATCH", body: patch }
  );
  return data.object;
}

export async function deleteOntologyObject(
  t: DoplTransport,
  objectId: string
): Promise<void> {
  await t.request<void>(`/api/ontology/objects/${enc(objectId)}`, {
    toolName: "ontology_delete_object",
    method: "DELETE",
  });
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

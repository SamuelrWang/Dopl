"use client";

import type { ObjectTypeId, OntologyCluster, OntologyObject, OntologySnapshot } from "../types";
import type { OntologyObjectUpdateInput } from "../schema";

export class OntologyApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "OntologyApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  workspaceId: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-workspace-id": workspaceId,
      ...init.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new OntologyApiError(
      res.status,
      err.code ?? "UNKNOWN",
      err.message ?? `Request failed (${res.status})`
    );
  }
  return body as T;
}

export function fetchSnapshot(workspaceId: string): Promise<OntologySnapshot> {
  return request(workspaceId, "/api/ontology");
}

export async function createCluster(
  workspaceId: string,
  input: { name: string; purpose?: string }
): Promise<OntologyCluster> {
  const { cluster } = await request<{ cluster: OntologyCluster }>(
    workspaceId,
    "/api/ontology/clusters",
    { method: "POST", body: JSON.stringify(input) }
  );
  return cluster;
}

export async function updateCluster(
  workspaceId: string,
  clusterId: string,
  input: { name?: string; purpose?: string }
): Promise<OntologyCluster> {
  const { cluster } = await request<{ cluster: OntologyCluster }>(
    workspaceId,
    `/api/ontology/clusters/${clusterId}`,
    { method: "PATCH", body: JSON.stringify(input) }
  );
  return cluster;
}

export function deleteCluster(workspaceId: string, clusterId: string): Promise<void> {
  return request(workspaceId, `/api/ontology/clusters/${clusterId}`, { method: "DELETE" });
}

export async function createObject(
  workspaceId: string,
  input: {
    clusterId?: string;
    parentObjectId?: string;
    /** Omitted on a card create → inherits the parent column's type. */
    objectType?: ObjectTypeId;
    name: string;
  }
): Promise<OntologyObject> {
  const { object } = await request<{ object: OntologyObject }>(
    workspaceId,
    "/api/ontology/objects",
    { method: "POST", body: JSON.stringify(input) }
  );
  return object;
}

export async function updateObject(
  workspaceId: string,
  objectId: string,
  input: OntologyObjectUpdateInput
): Promise<OntologyObject> {
  const { object } = await request<{ object: OntologyObject }>(
    workspaceId,
    `/api/ontology/objects/${objectId}`,
    { method: "PATCH", body: JSON.stringify(input) }
  );
  return object;
}

export function deleteObject(workspaceId: string, objectId: string): Promise<void> {
  return request(workspaceId, `/api/ontology/objects/${objectId}`, { method: "DELETE" });
}

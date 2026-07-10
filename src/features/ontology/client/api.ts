"use client";

import { ApiError, apiRequest } from "@/shared/api/api-client";
import type { OntologyCluster, OntologyObject, OntologySnapshot } from "../types";
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
  init: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {}
): Promise<T> {
  try {
    return await apiRequest<T>(path, {
      workspaceId,
      method: init.method,
      body: init.body,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      throw new OntologyApiError(err.status, err.code, err.message);
    }
    throw err;
  }
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
    { method: "POST", body: input }
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
    { method: "PATCH", body: input }
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
    name: string;
  }
): Promise<OntologyObject> {
  const { object } = await request<{ object: OntologyObject }>(
    workspaceId,
    "/api/ontology/objects",
    { method: "POST", body: input }
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
    { method: "PATCH", body: input }
  );
  return object;
}

export function deleteObject(workspaceId: string, objectId: string): Promise<void> {
  return request(workspaceId, `/api/ontology/objects/${objectId}`, { method: "DELETE" });
}

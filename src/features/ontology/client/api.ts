"use client";

import { ApiError, apiRequest } from "@/shared/api/api-client";
import type { GraphLayout } from "@/shared/graph";
import type {
  OntologyCluster,
  OntologyObject,
  OntologyShare,
  OntologySnapshot,
} from "../types";
import type { OntologyObjectUpdateInput } from "../schema";

/** Plan-gate code the free object-cap denial carries (ENGINEERING §8). */
export const OVER_FREE_CAP_CODE = "over_free_cap";

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

/**
 * True when a create failed on the free object cap. Route returns the flat
 * plan-gate envelope (`{ error: "over_free_cap", … }`, 403); `apiRequest`
 * surfaces it as the code, and the UI opens the upgrade modal instead of a
 * generic save toast.
 */
export function isOverFreeCapError(err: unknown): boolean {
  return err instanceof OntologyApiError && err.code === OVER_FREE_CAP_CODE;
}

async function request<T>(
  workspaceId: string,
  path: string,
  // ⚠ `PUT` JOINED THE UNION FOR THE SHARE LANE (2026-09-09) — a share states
  // the END STATE of three audiences, which is a PUT and not a POST.
  init: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown } = {}
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
  input: { name?: string; purpose?: string; layout?: GraphLayout }
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

/* ────────────────────────────────────────────────────────────────────────────
 * THE HOME-ONTOLOGY LANE (2026-09-09, `docs/specs/home-ontology.md` S5)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The two SHARING FIELDS a cluster carries once it is a home ontology, declared
 * here as a PARTIAL over `OntologyCluster` rather than added to that type.
 *
 * ⚠ **PARTIAL BECAUSE A CACHED SNAPSHOT PREDATES THEM** (INVARIANTS §8, the
 * stale-cache rule). `GET /api/ontology`'s body is served from IndexedDB on the
 * first paint after an upgrade, so a bundle that reads these fields must render
 * correctly against a payload written by a bundle that never sent them — which
 * is why every consumer goes through `hooks/use-ontologies.ts › ontologyListRows`
 * and never touches the raw field.
 *
 * ⚠ AND THE TWO FALLBACKS ARE DIFFERENT ANSWERS ON PURPOSE. `agentsMayEdit`
 * falls back to the COLUMN DEFAULT (`true` — Samuel's solo default is "viewable
 * and editable", spec §3.1), which is a fact. `sharedChannelCount` falls back to
 * `null` and the card then says NOTHING, because "shared into 0 channels" is a
 * claim about share rows this payload never carried — UNKNOWN is not EMPTY
 * (INVARIANTS §5A).
 */
export interface OntologyClusterSharing {
  /** The SOLO toggle (spec §5): may the owner's own agents write, or only read. */
  agentsMayEdit: boolean;
  /** How many channels this ontology is lent into. */
  sharedChannelCount: number;
}

/** One row of the /home Ontology face — a cluster, its size, and its sharing. */
export interface OntologyListRow {
  id: string;
  slug: string;
  name: string;
  purpose: string;
  /** Objects reachable from this cluster — a graph WALK, not a column (R5). */
  objectCount: number;
  agentsMayEdit: boolean;
  /** `null` when the payload did not carry it — render nothing, never "0". */
  sharedChannelCount: number | null;
}

/**
 * One `(ontology, channel)` share row as the share route serves it.
 *
 * ⚠ THE WIRE SHAPE IS `types.ts › OntologyShare` and this re-states nothing —
 * it is imported, so the dialog and the service cannot drift into two
 * vocabularies of the same three levels.
 */
export interface OntologySharesPayload {
  shares: OntologyShare[];
  /**
   * 🔒 **OFF THE SERVER, THE SAME PREDICATE THE WRITE APPLIES** (spec §5, the
   * rule `kb-channel-grants-section.tsx` states). A dialog that decided this
   * locally would render an editor for a caller the PUT then refuses.
   */
  canManage: boolean;
}

/** `GET` one ontology's share rows. ⚠ Cluster-scoped, so the dialog costs ONE
 *  read whatever the container's channel fan is. */
export function fetchOntologyShares(
  workspaceId: string,
  clusterId: string
): Promise<OntologySharesPayload> {
  return request(workspaceId, sharesPath(clusterId));
}

/**
 * SHARE, or re-state an existing share. ⚠ A PUT of the WHOLE triple, never a
 * patch of one level: a share row is a COMPLETE statement about three audiences
 * (I4), so a retry after an ambiguous failure lands the same row.
 */
export function putOntologyShare(
  workspaceId: string,
  clusterId: string,
  share: OntologyShare
): Promise<void> {
  return request(workspaceId, sharesPath(clusterId), {
    method: "PUT",
    body: share,
  });
}

/**
 * UNSHARE — a row DELETE, never a stored triple of `none` (I4).
 *
 * ⚠ THE CHANNEL RIDES THE QUERY STRING because a `DELETE` body is not carried
 * by every layer between here and the route. It is an opaque resource id, never
 * a person.
 */
export function deleteOntologyShare(
  workspaceId: string,
  clusterId: string,
  channelId: string
): Promise<void> {
  return request(
    workspaceId,
    `${sharesPath(clusterId)}?channelId=${encodeURIComponent(channelId)}`,
    { method: "DELETE" }
  );
}

/**
 * The SOLO TOGGLE's write — `agents_may_edit` on the cluster itself.
 *
 * ⚠ IT RIDES THE CLUSTER PATCH THAT ALREADY EXISTS rather than growing a route
 * of its own: it is a column on `ontology_clusters`, and `PATCH
 * /api/ontology/clusters/[clusterId]` is already the cluster write gate (spec
 * §4.4). A second endpoint would be a second floor to keep in step.
 */
export function setAgentsMayEdit(
  workspaceId: string,
  clusterId: string,
  agentsMayEdit: boolean
): Promise<unknown> {
  return request(workspaceId, `/api/ontology/clusters/${clusterId}`, {
    method: "PATCH",
    body: { agentsMayEdit },
  });
}

const sharesPath = (clusterId: string) =>
  `/api/ontology/clusters/${clusterId}/shares`;

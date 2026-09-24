"use client";

import { ApiError, apiRequest } from "@/shared/api/api-client";
import type { GraphLayout } from "@/shared/graph";
import type {
  Ontology,
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
  // `PUT` is the share lane's: a share states the end state of three audiences.
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

export async function createOntology(
  workspaceId: string,
  input: { name: string; purpose?: string }
): Promise<Ontology> {
  const { ontology } = await request<{ ontology: Ontology }>(
    workspaceId,
    "/api/ontology/ontologies",
    { method: "POST", body: input }
  );
  return ontology;
}

export async function updateOntology(
  workspaceId: string,
  ontologyId: string,
  input: { name?: string; purpose?: string; layout?: GraphLayout }
): Promise<Ontology> {
  const { ontology } = await request<{ ontology: Ontology }>(
    workspaceId,
    `/api/ontology/ontologies/${ontologyId}`,
    { method: "PATCH", body: input }
  );
  return ontology;
}

export function deleteOntology(workspaceId: string, ontologyId: string): Promise<void> {
  return request(workspaceId, `/api/ontology/ontologies/${ontologyId}`, { method: "DELETE" });
}

export async function createObject(
  workspaceId: string,
  input: {
    ontologyId?: string;
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
 * The two sharing fields an ontology carries once it is a home ontology, kept as a
 * partial over `Ontology` because a cached snapshot predates them
 * (INVARIANTS §8): `GET /api/ontology` is served from IndexedDB on the first paint
 * after an upgrade, so every consumer goes through
 * `hooks/use-ontologies.ts › ontologyListRows` and never the raw field.
 *
 * The fallbacks differ on purpose: `agentsMayEdit` falls back to the column
 * default (`true`), a fact; `sharedChannelCount` falls back to `null` and renders
 * nothing, because unknown is not empty (INVARIANTS §5A).
 */
export interface OntologySharing {
  /** The solo toggle (spec §5): may the owner's own agents write, or only read. */
  agentsMayEdit: boolean;
  /** How many channels this ontology is lent into. */
  sharedChannelCount: number;
}

/** One row of the /home Ontology face — an ontology, its size, and its sharing. */
export interface OntologyListRow {
  id: string;
  slug: string;
  name: string;
  purpose: string;
  /** Objects reachable from this ontology — a graph walk, not a column (R5). */
  objectCount: number;
  agentsMayEdit: boolean;
  /** `null` when the payload did not carry it — render nothing, never "0". */
  sharedChannelCount: number | null;
}

/**
 * One `(ontology, channel)` share row as the share route serves it. The wire shape
 * is `types.ts › OntologyShare`, imported rather than restated, so the dialog and
 * the service cannot drift into two vocabularies of the same three levels.
 */
export interface OntologySharesPayload {
  shares: OntologyShare[];
  /**
   * Off the server, the same predicate the write applies (spec §5). Decided
   * locally it would render an editor for a caller the PUT then refuses.
   */
  canManage: boolean;
}

/** `GET` one ontology's share rows. Ontology-scoped, so the dialog costs one read
 *  whatever the container's channel fan is. */
export function fetchOntologyShares(
  workspaceId: string,
  ontologyId: string
): Promise<OntologySharesPayload> {
  return request(workspaceId, sharesPath(ontologyId));
}

/**
 * Share, or re-state an existing share. A PUT of the whole triple, never a patch
 * of one level (I4), so a retry after an ambiguous failure lands the same row.
 */
export function putOntologyShare(
  workspaceId: string,
  ontologyId: string,
  share: OntologyShare
): Promise<void> {
  return request(workspaceId, sharesPath(ontologyId), {
    method: "PUT",
    body: share,
  });
}

/**
 * Unshare — a row DELETE, never a stored triple of `none` (I4). The channel rides
 * the query string because a `DELETE` body is not carried by every layer between
 * here and the route; it is an opaque resource id, never a person.
 */
export function deleteOntologyShare(
  workspaceId: string,
  ontologyId: string,
  channelId: string
): Promise<void> {
  return request(
    workspaceId,
    `${sharesPath(ontologyId)}?channelId=${encodeURIComponent(channelId)}`,
    { method: "DELETE" }
  );
}

/**
 * The solo toggle's write — `agents_may_edit` on the ontology. It rides the existing
 * ontology PATCH (already the ontology write gate, spec §4.4) rather than growing a
 * route of its own: a second endpoint would be a second floor to keep in step.
 */
export function setAgentsMayEdit(
  workspaceId: string,
  ontologyId: string,
  agentsMayEdit: boolean
): Promise<unknown> {
  return request(workspaceId, `/api/ontology/ontologies/${ontologyId}`, {
    method: "PATCH",
    body: { agentsMayEdit },
  });
}

const sharesPath = (ontologyId: string) =>
  `/api/ontology/ontologies/${ontologyId}/shares`;

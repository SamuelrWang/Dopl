import "server-only";
import { assertCanCreateObject } from "@/features/billing/server/entitlements";
import { HttpError } from "@/shared/lib/http-error";
import { slugify } from "@/shared/lib/slug/slugify";
import type {
  OntologyCluster,
  OntologyObject,
  OntologySnapshot,
} from "../types";
import type {
  OntologyClusterCreateInput,
  OntologyClusterUpdateInput,
  OntologyObjectCreateInput,
  OntologyObjectUpdateInput,
} from "../schema";
import {
  mapObjectRow,
  ONTOLOGY_READ_LIMITS,
  type OntologyClusterRow,
  type OntologyClusterSummary,
  type OntologyObjectSummary,
  type OntologySummary,
} from "./dto";
import * as repo from "./repository";
import * as narrow from "./repository-projections";

export interface OntologyContext {
  workspaceId: string;
  userId: string;
}

interface AuthLike {
  workspaceId: string;
  userId: string;
}

export function buildOntologyContext(auth: AuthLike): OntologyContext {
  return { workspaceId: auth.workspaceId, userId: auth.userId };
}

function mapClusterRow(row: OntologyClusterRow): OntologyCluster {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    purpose: row.purpose,
    layout: row.layout ?? {},
    columnIds: [],
  };
}

/** Whole-workspace ontology in the store shape UI and MCP share. Memberships
 *  and edges pointing at soft-deleted objects are dropped here. */
export async function getSnapshot(ctx: OntologyContext): Promise<OntologySnapshot> {
  const [clusterRows, objectRows, membershipRows, relationshipRows] = await Promise.all([
    repo.listClusters(ctx.workspaceId),
    repo.listObjects(ctx.workspaceId),
    repo.listMemberships(ctx.workspaceId),
    repo.listRelationships(ctx.workspaceId),
  ]);

  const objects: Record<string, OntologyObject> = {};
  for (const row of objectRows) objects[row.id] = mapObjectRow(row);

  const clusters = clusterRows.map(mapClusterRow);
  const clustersById = new Map(clusters.map((c) => [c.id, c]));

  for (const m of membershipRows) {
    if (!objects[m.child_object_id]) continue;
    if (m.cluster_id) {
      clustersById.get(m.cluster_id)?.columnIds.push(m.child_object_id);
    } else if (m.parent_object_id) {
      objects[m.parent_object_id]?.childIds.push(m.child_object_id);
    }
  }

  for (const r of relationshipRows) {
    const source = objects[r.source_object_id];
    if (!source || !objects[r.target_object_id]) continue;
    const edge = source.relationships.find((e) => e.label === r.label);
    if (edge) edge.targetIds.push(r.target_object_id);
    else source.relationships.push({ label: r.label, targetIds: [r.target_object_id] });
  }

  return { clusters, objects };
}

/**
 * Map-shaped read: `getSnapshot`'s structure minus every JSONB column and the
 * relationships table. Backs `dopl_map`. `truncated` = clipped by
 * `ONTOLOGY_READ_LIMITS`.
 *
 * ⚠ THREE reads, not four — relationships deliberately unfetched (nothing
 * map-shaped draws an edge; that table grows quadratically). Per-object edges
 * stay reachable via `op="get"`.
 *
 * ⚠ Not a `getSnapshot` replacement: the board renders `attributes`/`methods`/
 * `template` and `cluster.layout` round-trips through `updateCluster`.
 */
export async function getSummary(ctx: OntologyContext): Promise<OntologySummary> {
  const [clusterRows, objectRows, membershipRows] = await Promise.all([
    narrow.listClusterSummaries(ctx.workspaceId),
    narrow.listObjectSummaries(ctx.workspaceId),
    repo.listMemberships(ctx.workspaceId),
  ]);

  const objects: Record<string, OntologyObjectSummary> = {};
  for (const row of objectRows) {
    objects[row.id] = {
      id: row.id,
      name: row.name,
      subtitle: row.subtitle,
      childIds: [],
    };
  }

  const clusters: OntologyClusterSummary[] = clusterRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    purpose: row.purpose,
    columnIds: [],
  }));
  const clustersById = new Map(clusters.map((c) => [c.id, c]));

  for (const m of membershipRows) {
    if (!objects[m.child_object_id]) continue;
    if (m.cluster_id) {
      clustersById.get(m.cluster_id)?.columnIds.push(m.child_object_id);
    } else if (m.parent_object_id) {
      objects[m.parent_object_id]?.childIds.push(m.child_object_id);
    }
  }

  // At-ceiling is indistinguishable from exhausted → counts as clipped.
  const truncated =
    clusterRows.length >= ONTOLOGY_READ_LIMITS.clusters ||
    objectRows.length >= ONTOLOGY_READ_LIMITS.objects ||
    membershipRows.length >= ONTOLOGY_READ_LIMITS.memberships;

  return { clusters, objects, truncated };
}

export async function createCluster(
  ctx: OntologyContext,
  input: OntologyClusterCreateInput
): Promise<OntologyCluster> {
  const slugs = await narrow.listClusterSlugs(ctx.workspaceId);
  const slug = slugify(input.name, "cluster", slugs);
  const row = await repo.insertCluster({
    workspaceId: ctx.workspaceId,
    slug,
    name: input.name,
    purpose: input.purpose ?? "",
    position: slugs.length,
    createdBy: ctx.userId,
  });
  return mapClusterRow(row);
}

export async function updateCluster(
  ctx: OntologyContext,
  clusterId: string,
  input: OntologyClusterUpdateInput
): Promise<OntologyCluster> {
  const row = await repo.updateCluster(ctx.workspaceId, clusterId, input);
  if (!row) throw HttpError.notFound("Cluster not found");
  return mapClusterRow(row);
}

/**
 * Cascade HARD-delete cluster + every object it owns, one atomic RPC.
 * Permanent: no trash/restore/purge. ⚠ Must stay one transaction — two writes
 * can delete the objects and leave the cluster behind. Returns objects
 * cascaded; RPC null = no live cluster → 404 (≠ a cluster that owned 0).
 */
export async function deleteCluster(ctx: OntologyContext, clusterId: string): Promise<number> {
  const count = await repo.cascadeHardDeleteCluster(ctx.workspaceId, clusterId);
  if (count === null) throw HttpError.notFound("Cluster not found");
  return count;
}

export async function createObject(
  ctx: OntologyContext,
  input: OntologyObjectCreateInput
): Promise<OntologyObject> {
  // Sole create-time choke point for free-plan object cap. Columns + nested
  // cards land here; createCluster inserts no object row so it isn't gated.
  // Freeze-don't-delete: only creation blocked, never updates/deletes/reads.
  await assertCanCreateObject(ctx.workspaceId);

  let attributes: OntologyObject["attributes"] | undefined;
  let methods: OntologyObject["methods"] | undefined;
  let inheritedEdges: OntologyObject["relationships"] | undefined;
  if (input.clusterId) {
    const cluster = await repo.findClusterById(ctx.workspaceId, input.clusterId);
    if (!cluster) throw HttpError.notFound("Cluster not found");
  } else if (input.parentObjectId) {
    const parent = await repo.findObjectById(ctx.workspaceId, input.parentObjectId);
    if (!parent) throw HttpError.notFound("Parent object not found");
    // Columns act as templates: new card born with column's default fields as
    // empty attributes, plus a copy of its relationships and actions.
    attributes = (parent.template ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      value:
        f.kind === "text" || f.kind === "pill"
          ? { kind: f.kind, value: "" }
          : { kind: f.kind, value: [] },
    }));
    methods = parent.methods ?? [];
    inheritedEdges = await currentRelationships(ctx, parent.id);
  }

  const row = await repo.insertObject({
    workspaceId: ctx.workspaceId,
    name: input.name,
    createdBy: ctx.userId,
    attributes,
    methods,
  });
  const position = await repo.countMembershipSiblings(
    ctx.workspaceId,
    input.clusterId
      ? { clusterId: input.clusterId }
      : { parentObjectId: input.parentObjectId as string }
  );
  await repo.insertMembership({
    workspaceId: ctx.workspaceId,
    clusterId: input.clusterId ?? null,
    parentObjectId: input.parentObjectId ?? null,
    childObjectId: row.id,
    position,
  });
  if (inheritedEdges?.length) {
    await repo.replaceRelationshipsForSource(ctx.workspaceId, row.id, inheritedEdges);
  }
  const object = mapObjectRow(row);
  object.relationships = inheritedEdges ?? [];
  return object;
}

/** 412 on optimistic-concurrency miss. ⚠ Must mirror KB/skills
 *  `*_STALE_VERSION` contract so MCP conflict handling (re-get, reconcile,
 *  retry) fires uniformly across tools. */
function staleVersionError(expected: string, actual: string): HttpError {
  return new HttpError(
    412,
    "ONTOLOGY_STALE_VERSION",
    `Stale write rejected — the object was modified at ${actual} but the request expected ${expected}. Re-get it, reconcile your change, and retry.`,
    { expected, actual }
  );
}

export async function updateObject(
  ctx: OntologyContext,
  objectId: string,
  input: OntologyObjectUpdateInput,
  expectedUpdatedAt?: string
): Promise<OntologyObject> {
  const { relationships, ...rest } = input;

  const hasFieldPatch = Object.values(rest).some((v) => v !== undefined);

  let row;
  if (hasFieldPatch) {
    // Field patch touches the row → CAS rides the atomic `updated_at` filter
    // (0 rows = stale-or-gone; disambiguated below).
    row = await repo.updateObject(ctx.workspaceId, objectId, rest, expectedUpdatedAt);
    if (!row) {
      if (expectedUpdatedAt !== undefined) {
        const current = await repo.findObjectById(ctx.workspaceId, objectId);
        if (current) throw staleVersionError(expectedUpdatedAt, current.updated_at);
      }
      throw HttpError.notFound("Object not found");
    }
  } else {
    // Relationship-only (or no-op) writes never touch the object row, so
    // `updated_at` wouldn't move — enforce the precondition by hand.
    row = await repo.findObjectById(ctx.workspaceId, objectId);
    if (!row) throw HttpError.notFound("Object not found");
    if (expectedUpdatedAt !== undefined && row.updated_at !== expectedUpdatedAt) {
      throw staleVersionError(expectedUpdatedAt, row.updated_at);
    }
  }

  let cleanEdges: OntologyObject["relationships"] | undefined;
  if (relationships) {
    cleanEdges = await sanitizeEdges(ctx, objectId, relationships);
    await repo.replaceRelationshipsForSource(ctx.workspaceId, objectId, cleanEdges);
    // Edge write bumps source `updated_at` via the ontology_relationships
    // trigger (H-4) → re-read for the post-bump version token, else caller's
    // next CAS write spuriously 412s.
    const refreshed = await repo.findObjectById(ctx.workspaceId, objectId);
    if (refreshed) row = refreshed;
  }

  const object = mapObjectRow(row);
  object.relationships = cleanEdges ?? (await currentRelationships(ctx, objectId));
  return object;
}

/**
 * Make a relationship payload safe to persist: merge same-label edges (a rename
 * can collide labels — merging beats a unique-index 500), dedupe targets, drop
 * self-refs and non-live targets (clients hold stale ids after a delete).
 */
async function sanitizeEdges(
  ctx: OntologyContext,
  objectId: string,
  edges: Array<{ label: string; targetIds: string[] }>
): Promise<OntologyObject["relationships"]> {
  const valid = await repo.filterObjectIds(
    ctx.workspaceId,
    edges.flatMap((e) => e.targetIds)
  );

  const byLabel = new Map<string, string[]>();
  for (const edge of edges) {
    const label = edge.label.trim();
    if (!label) continue;
    const targets = byLabel.get(label) ?? [];
    for (const targetId of edge.targetIds) {
      if (targetId === objectId || !valid.has(targetId)) continue;
      if (!targets.includes(targetId)) targets.push(targetId);
    }
    byLabel.set(label, targets);
  }
  return [...byLabel.entries()]
    .filter(([, targetIds]) => targetIds.length > 0)
    .map(([label, targetIds]) => ({ label, targetIds }));
}

/**
 * One object's outbound edges. ⚠ Scope in Postgres, not JS — `source_object_id`
 * is indexed, and this sits on four hot paths (inherited-edge copy at create,
 * every update, claim_anchor, get_anchor). Never filter `listRelationships`.
 */
async function currentRelationships(
  ctx: OntologyContext,
  objectId: string
): Promise<OntologyObject["relationships"]> {
  const rows = await narrow.listRelationshipsForSource(ctx.workspaceId, objectId);
  const edges: OntologyObject["relationships"] = [];
  for (const r of rows) {
    const edge = edges.find((e) => e.label === r.label);
    if (edge) edge.targetIds.push(r.target_object_id);
    else edges.push({ label: r.label, targetIds: [r.target_object_id] });
  }
  return edges;
}

/** PERMANENTLY delete one object. Irreversible, no trash. Memberships and
 *  relationships cascade via FK. */
export async function deleteObject(ctx: OntologyContext, objectId: string): Promise<void> {
  const row = await repo.findObjectById(ctx.workspaceId, objectId);
  if (!row) throw HttpError.notFound("Object not found");
  await repo.hardDeleteObject(ctx.workspaceId, objectId);
}

/** Link the caller's account to an object (their identity anchor). */
export async function claimAnchor(
  ctx: OntologyContext,
  objectId: string
): Promise<OntologyObject> {
  const row = await repo.setAnchor(ctx.workspaceId, ctx.userId, objectId);
  if (!row) throw HttpError.notFound("Object not found");
  const object = mapObjectRow(row);
  object.relationships = await currentRelationships(ctx, objectId);
  return object;
}

/** Caller's identity anchor — object linked via `ontology_objects.user_id`,
 *  or null. */
export async function getAnchor(ctx: OntologyContext): Promise<OntologyObject | null> {
  const row = await repo.findAnchorObject(ctx.workspaceId, ctx.userId);
  if (!row) return null;
  const object = mapObjectRow(row);
  object.relationships = await currentRelationships(ctx, row.id);
  return object;
}

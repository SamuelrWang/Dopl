import "server-only";
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
import { mapObjectRow, type OntologyClusterRow } from "./dto";
import * as repo from "./repository";

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
    columnIds: [],
  };
}

/**
 * The whole workspace ontology, assembled into the store shape the UI
 * and MCP layers share: clusters with ordered columnIds, objects with
 * ordered childIds and grouped relationships. Memberships or edges
 * pointing at soft-deleted objects are dropped here.
 */
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

export async function createCluster(
  ctx: OntologyContext,
  input: OntologyClusterCreateInput
): Promise<OntologyCluster> {
  const existing = await repo.listClusters(ctx.workspaceId);
  const slug = slugify(input.name, "cluster", existing.map((c) => c.slug));
  const row = await repo.insertCluster({
    workspaceId: ctx.workspaceId,
    slug,
    name: input.name,
    purpose: input.purpose ?? "",
    position: existing.length,
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

export async function deleteCluster(ctx: OntologyContext, clusterId: string): Promise<void> {
  const row = await repo.findClusterById(ctx.workspaceId, clusterId);
  if (!row) throw HttpError.notFound("Cluster not found");
  await repo.markClusterDeleted(ctx.workspaceId, clusterId);
}

export async function createObject(
  ctx: OntologyContext,
  input: OntologyObjectCreateInput
): Promise<OntologyObject> {
  if (input.clusterId) {
    const cluster = await repo.findClusterById(ctx.workspaceId, input.clusterId);
    if (!cluster) throw HttpError.notFound("Cluster not found");
  } else if (input.parentObjectId) {
    const parent = await repo.findObjectById(ctx.workspaceId, input.parentObjectId);
    if (!parent) throw HttpError.notFound("Parent object not found");
  }

  const row = await repo.insertObject({
    workspaceId: ctx.workspaceId,
    objectType: input.objectType,
    name: input.name,
    createdBy: ctx.userId,
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
  return mapObjectRow(row);
}

export async function updateObject(
  ctx: OntologyContext,
  objectId: string,
  input: OntologyObjectUpdateInput
): Promise<OntologyObject> {
  const { relationships, objectType, ...rest } = input;

  const hasFieldPatch =
    Object.values(rest).some((v) => v !== undefined) || objectType !== undefined;

  const row = hasFieldPatch
    ? await repo.updateObject(ctx.workspaceId, objectId, { ...rest, objectType })
    : await repo.findObjectById(ctx.workspaceId, objectId);
  if (!row) throw HttpError.notFound("Object not found");

  let cleanEdges: OntologyObject["relationships"] | undefined;
  if (relationships) {
    cleanEdges = await sanitizeEdges(ctx, objectId, relationships);
    await repo.replaceRelationshipsForSource(ctx.workspaceId, objectId, cleanEdges);
  }

  const object = mapObjectRow(row);
  object.relationships = cleanEdges ?? (await currentRelationships(ctx, objectId));
  return object;
}

/**
 * Make a relationship payload safe to persist: merge same-label edges
 * (a rename can collide labels — merging beats a unique-index 500),
 * dedupe targets, and silently drop self-references and targets that
 * aren't live objects in this workspace (clients can hold stale ids
 * after a delete; sync must stay resilient).
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

async function currentRelationships(
  ctx: OntologyContext,
  objectId: string
): Promise<OntologyObject["relationships"]> {
  const rows = await repo.listRelationships(ctx.workspaceId);
  const edges: OntologyObject["relationships"] = [];
  for (const r of rows) {
    if (r.source_object_id !== objectId) continue;
    const edge = edges.find((e) => e.label === r.label);
    if (edge) edge.targetIds.push(r.target_object_id);
    else edges.push({ label: r.label, targetIds: [r.target_object_id] });
  }
  return edges;
}

export async function deleteObject(ctx: OntologyContext, objectId: string): Promise<void> {
  const row = await repo.findObjectById(ctx.workspaceId, objectId);
  if (!row) throw HttpError.notFound("Object not found");
  await repo.markObjectDeleted(ctx.workspaceId, objectId);
}

/**
 * The caller's identity anchor — the ontology object linked to their
 * user account (ontology_objects.user_id), or null when none is linked.
 */
export async function getAnchor(ctx: OntologyContext): Promise<OntologyObject | null> {
  const row = await repo.findAnchorObject(ctx.workspaceId, ctx.userId);
  if (!row) return null;
  const object = mapObjectRow(row);
  object.relationships = await currentRelationships(ctx, row.id);
  return object;
}

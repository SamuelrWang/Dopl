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
import { mapObjectRow, type OntologyClusterRow, type OntologyMembershipRow } from "./dto";
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
    layout: row.layout ?? {},
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
  // Soft delete is an UPDATE, so the FK ON DELETE CASCADE never fires —
  // cascade in code so the cluster's columns and their nested cards don't
  // orphan as live objects. Memberships/relationships stay put; the
  // snapshot drops them once their objects are gone (as with deleteObject).
  const memberships = await repo.listMemberships(ctx.workspaceId);
  const objectIds = clusterObjectIds(memberships, clusterId);
  await repo.markObjectsDeleted(ctx.workspaceId, objectIds);
  await repo.markClusterDeleted(ctx.workspaceId, clusterId);
}

/**
 * Every object a cluster owns: its columns (memberships with this
 * cluster_id) plus all nested cards reached by walking parent_object_id
 * memberships. Visited-set guards against cycles from shared objects.
 */
function clusterObjectIds(
  memberships: OntologyMembershipRow[],
  clusterId: string
): string[] {
  const childrenByParent = new Map<string, string[]>();
  const columns: string[] = [];
  for (const m of memberships) {
    if (m.cluster_id === clusterId) columns.push(m.child_object_id);
    if (m.parent_object_id) {
      const kids = childrenByParent.get(m.parent_object_id) ?? [];
      kids.push(m.child_object_id);
      childrenByParent.set(m.parent_object_id, kids);
    }
  }
  const collected = new Set<string>();
  const stack = [...columns];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || collected.has(id)) continue;
    collected.add(id);
    const kids = childrenByParent.get(id);
    if (kids) stack.push(...kids);
  }
  return [...collected];
}

export async function createObject(
  ctx: OntologyContext,
  input: OntologyObjectCreateInput
): Promise<OntologyObject> {
  // Single create-time choke point for the free-plan object cap. Columns
  // and nested cards both land here (createCluster inserts no object row,
  // so it isn't gated). Freeze-don't-delete: only creation is blocked —
  // updates / deletes / reads never call this.
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
    // Columns act as templates: a new card is born with the column's
    // default fields as empty attributes ready to fill, and copies the
    // column's relationships and actions as its starting set.
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

export async function updateObject(
  ctx: OntologyContext,
  objectId: string,
  input: OntologyObjectUpdateInput
): Promise<OntologyObject> {
  const { relationships, ...rest } = input;

  const hasFieldPatch = Object.values(rest).some((v) => v !== undefined);

  const row = hasFieldPatch
    ? await repo.updateObject(ctx.workspaceId, objectId, rest)
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

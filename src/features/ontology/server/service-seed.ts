import "server-only";
import { randomUUID } from "node:crypto";
import { slugify } from "@/shared/lib/slug/slugify";
import type { ObjectAttribute } from "../types";
import * as repo from "./repository";
import * as seedRepo from "./repository-seed";
import { buildOntologySeed, type SeedAttr } from "./seed";

/**
 * Cross-reference maps the orchestrator threads in: stable entry key →
 * knowledge entry uuid, and skill slug → skill uuid. Attributes whose
 * refs don't resolve are dropped (best-effort), never persisted dangling.
 */
export interface OntologySeedRefs {
  entryIdByKey: Record<string, string>;
  skillIdBySlug: Record<string, string>;
}

export interface OntologySeedContext {
  workspaceId: string;
  userId: string;
}

export interface SeedOntologyResult {
  clusterId: string | null;
  objectsCreated: number;
  relationshipsCreated: number;
}

/** Build the persisted attribute list, resolving knowledge/skill refs. */
function resolveAttributes(
  attrs: SeedAttr[],
  refs: OntologySeedRefs
): ObjectAttribute[] {
  const out: ObjectAttribute[] = [];
  for (const attr of attrs) {
    const key = attr.label.toLowerCase().replace(/\s+/g, "-");
    if (attr.kind === "text") {
      out.push({ key, label: attr.label, value: { kind: "text", value: attr.value } });
      continue;
    }
    const ids =
      attr.kind === "knowledge"
        ? attr.entryKeys.map((k) => refs.entryIdByKey[k]).filter(Boolean)
        : attr.skillSlugs.map((s) => refs.skillIdBySlug[s]).filter(Boolean);
    // Skip a link attribute whose refs didn't resolve — no dangling ids.
    if (ids.length === 0) continue;
    out.push({ key, label: attr.label, value: { kind: attr.kind, value: ids } });
  }
  return out;
}

/**
 * Seeds the "Dopl Playbook" cluster: two columns of objects whose
 * attributes point at the seeded skills + knowledge entries, plus a few
 * labelled relationships. Inserts via the repository directly (system
 * content — the free-plan object cap gate in `service.createObject` is
 * deliberately bypassed; a fresh solo workspace is uncapped anyway).
 *
 * FOUR writes, whatever the corpus size: cluster, objects, memberships,
 * relationships. It used to be ~34 serial round-trips — an `insertObject`
 * followed by an `updateObject` on the SAME row for every one of the nine
 * objects, a membership insert each, and a delete+insert replace-set per
 * relationship source — every one of them awaited before the user was
 * redirected out of the auth callback. Object uuids are minted here, so
 * the memberships and relationships that point at them are built up front
 * instead of being discovered one insert at a time.
 */
export async function seedWorkspace(
  ctx: OntologySeedContext,
  refs: OntologySeedRefs
): Promise<SeedOntologyResult> {
  const seed = buildOntologySeed();
  const existing = await repo.listClusters(ctx.workspaceId);
  const slug = slugify(seed.clusterSlug, "cluster", existing.map((c) => c.slug));

  const idByKey: Record<string, string> = {};
  const objects: Parameters<typeof seedRepo.insertObjects>[0] = [];
  const memberships: Parameters<typeof seedRepo.insertMemberships>[0] = [];

  for (const column of seed.columns) {
    const columnId = randomUUID();
    idByKey[column.key] = columnId;
    objects.push({
      id: columnId,
      workspaceId: ctx.workspaceId,
      name: column.name,
      createdBy: ctx.userId,
      ...(column.subtitle ? { subtitle: column.subtitle } : {}),
      template: column.template,
    });

    column.children.forEach((child, childIndex) => {
      const childId = randomUUID();
      idByKey[child.key] = childId;
      objects.push({
        id: childId,
        workspaceId: ctx.workspaceId,
        name: child.name,
        createdBy: ctx.userId,
        ...(child.subtitle ? { subtitle: child.subtitle } : {}),
        attributes: resolveAttributes(child.attributes, refs),
      });
      memberships.push({
        workspaceId: ctx.workspaceId,
        clusterId: null,
        parentObjectId: columnId,
        childObjectId: childId,
        position: childIndex,
      });
    });
  }

  // Relationship rows, flattened. `position` reproduces the ordering
  // `replaceRelationshipsForSource` assigns (edge index × 1000 + target
  // index), per source object.
  const edges: Parameters<typeof seedRepo.insertRelationships>[1] = [];
  const edgeIndexBySource = new Map<string, number>();
  let relationshipsCreated = 0;
  for (const rel of seed.relationships) {
    const sourceObjectId = idByKey[rel.fromKey];
    if (!sourceObjectId) continue;
    const targetIds = rel.toKeys.map((k) => idByKey[k]).filter(Boolean);
    if (targetIds.length === 0) continue;
    const edgeIndex = edgeIndexBySource.get(sourceObjectId) ?? 0;
    edgeIndexBySource.set(sourceObjectId, edgeIndex + 1);
    targetIds.forEach((targetObjectId, targetIndex) => {
      edges.push({
        sourceObjectId,
        label: rel.label,
        targetObjectId,
        position: edgeIndex * 1000 + targetIndex,
      });
    });
    relationshipsCreated += 1;
  }

  // The cluster and the objects are independent; the memberships need
  // both (`cluster_id` on the columns, `parent_object_id` on the cards)
  // and the relationships need the objects. Two waves, four statements.
  const [cluster] = await Promise.all([
    repo.insertCluster({
      workspaceId: ctx.workspaceId,
      slug,
      name: seed.clusterName,
      purpose: seed.purpose,
      position: existing.length,
      createdBy: ctx.userId,
    }),
    seedRepo.insertObjects(objects),
  ]);

  await Promise.all([
    seedRepo.insertMemberships([
      ...seed.columns.map((column, colIndex) => ({
        workspaceId: ctx.workspaceId,
        clusterId: cluster.id,
        parentObjectId: null,
        childObjectId: idByKey[column.key],
        position: colIndex,
      })),
      ...memberships,
    ]),
    seedRepo.insertRelationships(ctx.workspaceId, edges),
  ]);

  return { clusterId: cluster.id, objectsCreated: objects.length, relationshipsCreated };
}

import "server-only";
import { slugify } from "@/shared/lib/slug/slugify";
import type { ObjectAttribute } from "../types";
import * as repo from "./repository";
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
 */
export async function seedWorkspace(
  ctx: OntologySeedContext,
  refs: OntologySeedRefs
): Promise<SeedOntologyResult> {
  const seed = buildOntologySeed();
  const existing = await repo.listClusters(ctx.workspaceId);
  const slug = slugify(seed.clusterSlug, "cluster", existing.map((c) => c.slug));

  const cluster = await repo.insertCluster({
    workspaceId: ctx.workspaceId,
    slug,
    name: seed.clusterName,
    purpose: seed.purpose,
    position: existing.length,
    createdBy: ctx.userId,
  });

  const idByKey: Record<string, string> = {};
  let objectsCreated = 0;

  for (let colIndex = 0; colIndex < seed.columns.length; colIndex++) {
    const column = seed.columns[colIndex];
    const columnRow = await repo.insertObject({
      workspaceId: ctx.workspaceId,
      name: column.name,
      createdBy: ctx.userId,
    });
    await repo.updateObject(ctx.workspaceId, columnRow.id, {
      subtitle: column.subtitle,
      template: column.template,
    });
    await repo.insertMembership({
      workspaceId: ctx.workspaceId,
      clusterId: cluster.id,
      parentObjectId: null,
      childObjectId: columnRow.id,
      position: colIndex,
    });
    idByKey[column.key] = columnRow.id;
    objectsCreated += 1;

    for (let childIndex = 0; childIndex < column.children.length; childIndex++) {
      const child = column.children[childIndex];
      const attributes = resolveAttributes(child.attributes, refs);
      const childRow = await repo.insertObject({
        workspaceId: ctx.workspaceId,
        name: child.name,
        createdBy: ctx.userId,
        attributes,
      });
      if (child.subtitle) {
        await repo.updateObject(ctx.workspaceId, childRow.id, { subtitle: child.subtitle });
      }
      await repo.insertMembership({
        workspaceId: ctx.workspaceId,
        clusterId: null,
        parentObjectId: columnRow.id,
        childObjectId: childRow.id,
        position: childIndex,
      });
      idByKey[child.key] = childRow.id;
      objectsCreated += 1;
    }
  }

  let relationshipsCreated = 0;
  const bySource = new Map<string, Array<{ label: string; targetIds: string[] }>>();
  for (const rel of seed.relationships) {
    const sourceId = idByKey[rel.fromKey];
    if (!sourceId) continue;
    const targetIds = rel.toKeys.map((k) => idByKey[k]).filter(Boolean);
    if (targetIds.length === 0) continue;
    const edges = bySource.get(sourceId) ?? [];
    edges.push({ label: rel.label, targetIds });
    bySource.set(sourceId, edges);
    relationshipsCreated += 1;
  }
  for (const [sourceId, edges] of bySource) {
    await repo.replaceRelationshipsForSource(ctx.workspaceId, sourceId, edges);
  }

  return { clusterId: cluster.id, objectsCreated, relationshipsCreated };
}

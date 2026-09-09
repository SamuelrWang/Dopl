import "server-only";
import { assertCanCreateObject } from "@/features/billing/server/entitlements";
import { HttpError } from "@/shared/lib/http-error";
import { slugify } from "@/shared/lib/slug/slugify";
import type { Role } from "@/features/workspaces/types";
import type {
  OntologyCluster,
  OntologyContext,
  OntologyObject,
} from "../types";
import type {
  OntologyClusterCreateInput,
  OntologyClusterUpdateInput,
  OntologyObjectCreateInput,
  OntologyObjectUpdateInput,
} from "../schema";
import { mapObjectRow } from "./dto";
import * as repo from "./repository";
import * as anchorRepo from "./repository-anchor";
import * as narrow from "./repository-projections";
import { resolveOntologyAudience } from "./service-audience";
import {
  admittedObjectIds,
  assertCanCreateCluster,
  requireCluster,
  requireObject,
} from "./service-gates";
import { mapClusterRow, getSnapshot, getSummary } from "./service-reads";
import { getReach } from "./service-reach";

/**
 * Ontology business logic — WRITES, their gates, and the anchor. The two graph
 * READS live in `service-reads.ts` and are re-exported below, so every route,
 * MCP tool and client keeps importing them from here.
 *
 * 🔒 **EVERY WRITE PASSES `service-gates.ts` FIRST, AND THE GATE RETURNS THE
 * ROW.** A lent ontology lives in the LENDER's container while the caller
 * stands in the channel's, so each write below targets `row.workspace_id` and
 * never `ctx.workspaceId`. Using the context's container would 404 a row the
 * caller is allowed to edit — and, on a create, would file it under the wrong
 * tenancy.
 */

export { getSnapshot, getSummary, getReach };

interface AuthLike {
  workspaceId: string;
  userId: string;
  role: Role;
  agentTokenId?: string | null;
  /** WHOSE REACH the credential inherits; `null` = nobody in particular.
   *  ⚠ REQUIRED — this axis has no safe default (F-336). */
  credentialSubjectUserId: string | null;
}

/**
 * `withWorkspaceAuth` (or the MCP equivalent) result → {@link OntologyContext}.
 * Source derives from agent-token presence, exactly as
 * `knowledge/server/service-shared.ts › buildKnowledgeContext` derives it.
 *
 * ⚠ **ONE CONTEXT OBJECT PER REQUEST IS LOAD-BEARING**, not a style: the
 * audience ceiling is memoised against this object's identity
 * (`service-audience.ts › AUDIENCE_CACHE`), so a handler that built two would
 * resolve the ceiling twice, and one that reused a module-level constant would
 * share it between requests.
 */
export function buildOntologyContext(auth: AuthLike): OntologyContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    role: auth.role,
    source: auth.agentTokenId ? "agent" : "user",
    credentialSubjectUserId: auth.credentialSubjectUserId,
  };
}

export async function createCluster(
  ctx: OntologyContext,
  input: OntologyClusterCreateInput
): Promise<OntologyCluster> {
  await assertCanCreateCluster(ctx);
  const slugs = await narrow.listClusterSlugs(ctx.workspaceId);
  const slug = slugify(input.name, "cluster", slugs);
  const row = await repo.insertCluster({
    workspaceId: ctx.workspaceId,
    slug,
    name: input.name,
    purpose: input.purpose ?? "",
    position: slugs.length,
    createdBy: ctx.userId,
    source: ctx.source,
  });
  return mapClusterRow(row);
}

export async function updateCluster(
  ctx: OntologyContext,
  clusterId: string,
  input: OntologyClusterUpdateInput
): Promise<OntologyCluster> {
  const gated = await requireCluster(ctx, clusterId, "edit");
  // 🔒 CONTAINMENT: the solo toggle decides what THIS SESSION's own class may
  // do, so a session that could write it would be one call from re-widening
  // itself — the argument `channels/[channelId]/members` makes for
  // `agentToolProfile`, applied one layer lower so the MCP path inherits it.
  if (input.agentsMayEdit !== undefined && ctx.source === "agent") {
    throw new HttpError(
      403,
      "ONTOLOGY_AGENT_SETTING_FORBIDDEN",
      "Whether your agents may edit this ontology is a human-only setting."
    );
  }
  const row = await repo.updateCluster(gated.workspace_id, clusterId, input, {
    userId: ctx.userId,
    source: ctx.source,
  });
  if (!row) throw HttpError.notFound("Cluster not found");
  return mapClusterRow(row);
}

/**
 * Cascade HARD-delete cluster + every object it owns, one atomic RPC.
 * Permanent: no trash/restore/purge. ⚠ Must stay one transaction — two writes
 * can delete the objects and leave the cluster behind. Returns objects
 * cascaded; RPC null = no live cluster → 404 (≠ a cluster that owned 0).
 *
 * ⚠ Q4 — THE SHARE ROWS CASCADE BY FK (`ontology_channel_shares.ontology_id
 * ON DELETE CASCADE`, spec §3.1). Nothing here deletes them by hand: a
 * hand-written cascade beside a declared one is the copy that stops matching.
 */
export async function deleteCluster(
  ctx: OntologyContext,
  clusterId: string
): Promise<number> {
  const gated = await requireCluster(ctx, clusterId, "edit");
  const count = await repo.cascadeHardDeleteCluster(gated.workspace_id, clusterId);
  if (count === null) throw HttpError.notFound("Cluster not found");
  return count;
}

export async function createObject(
  ctx: OntologyContext,
  input: OntologyObjectCreateInput
): Promise<OntologyObject> {
  // 🔒 The write gate comes FIRST and decides the container: a column lands in
  // its cluster's, a card in its parent's. Q9 applies through `requireObject`
  // for the parent case — a card inherits the parent's cluster set, so the
  // parent's ALL-clusters `edit` is the same question asked one row up.
  let workspaceId: string;
  let attributes: OntologyObject["attributes"] | undefined;
  let methods: OntologyObject["methods"] | undefined;
  let inheritedEdges: OntologyObject["relationships"] | undefined;
  if (input.clusterId) {
    workspaceId = (await requireCluster(ctx, input.clusterId, "edit")).workspace_id;
  } else {
    const parent = await requireObject(ctx, input.parentObjectId as string, "edit");
    workspaceId = parent.workspace_id;
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

  // Sole create-time choke point for free-plan object cap. Columns + nested
  // cards land here; createCluster inserts no object row so it isn't gated.
  // Freeze-don't-delete: only creation blocked, never updates/deletes/reads.
  // ⚠ Billed to the ROW's container, which is the OWNER's when a peer creates
  // inside a lent ontology (R11, and `credits-service.ts › resolveBillingTarget`
  // already reroutes container burn to the owner).
  await assertCanCreateObject(workspaceId);

  const row = await repo.insertObject({
    workspaceId,
    name: input.name,
    createdBy: ctx.userId,
    source: ctx.source,
    attributes,
    methods,
  });
  const position = await repo.countMembershipSiblings(
    workspaceId,
    input.clusterId
      ? { clusterId: input.clusterId }
      : { parentObjectId: input.parentObjectId as string }
  );
  await repo.insertMembership({
    workspaceId,
    clusterId: input.clusterId ?? null,
    parentObjectId: input.parentObjectId ?? null,
    childObjectId: row.id,
    position,
  });
  if (inheritedEdges?.length) {
    await repo.replaceRelationshipsForSource(workspaceId, row.id, inheritedEdges);
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
  // 🔒 Q9 — `edit` on EVERY cluster this object belongs to, before any write.
  const gated = await requireObject(ctx, objectId, "edit");
  const workspaceId = gated.workspace_id;
  const scope = [workspaceId];
  const editor = { userId: ctx.userId, source: ctx.source };
  const { relationships, ...rest } = input;

  const hasFieldPatch = Object.values(rest).some((v) => v !== undefined);

  let row;
  if (hasFieldPatch) {
    // Field patch touches the row → CAS rides the atomic `updated_at` filter
    // (0 rows = stale-or-gone; disambiguated below).
    row = await repo.updateObject(workspaceId, objectId, rest, editor, expectedUpdatedAt);
    if (!row) {
      if (expectedUpdatedAt !== undefined) {
        const current = await repo.findObjectById(scope, objectId);
        if (current) throw staleVersionError(expectedUpdatedAt, current.updated_at);
      }
      throw HttpError.notFound("Object not found");
    }
  } else {
    // Relationship-only (or no-op) writes never touch the object row, so
    // `updated_at` wouldn't move — enforce the precondition by hand.
    row = gated;
    if (expectedUpdatedAt !== undefined && row.updated_at !== expectedUpdatedAt) {
      throw staleVersionError(expectedUpdatedAt, row.updated_at);
    }
  }

  let cleanEdges: OntologyObject["relationships"] | undefined;
  if (relationships) {
    cleanEdges = await sanitizeEdges(ctx, objectId, relationships);
    await repo.replaceRelationshipsForSource(workspaceId, objectId, cleanEdges);
    // Edge write bumps source `updated_at` via the ontology_relationships
    // trigger (H-4) → re-read for the post-bump version token, else caller's
    // next CAS write spuriously 412s.
    const refreshed = await repo.findObjectById(scope, objectId);
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
 *
 * 🔒 **TARGETS ARE VALIDATED AGAINST THE AUDIENCE'S ANSWER, NOT ITS SCOPE, AND
 * THE DIFFERENCE IS Q8.** The scope holds the LENDER's whole container — it has
 * to, or the lend is unreachable — so `repository.ts › filterObjectIds` alone
 * would let somebody lent ONE ontology point an edge at any row in that
 * container they could name, writing into a graph they cannot see. That is
 * exactly the "widens the scope and forgets the filter" failure this feature's
 * headers warn about, arriving on a WRITE. `service-gates.ts ›
 * admittedObjectIds` applies the cluster walk on top, so a target must sit in a
 * cluster this caller reaches at `view`.
 *
 * ⚠ It is still a `filter`, never a refusal: clients hold stale ids after a
 * delete, and a 400 on one dropped target would fail a whole legitimate save.
 */
async function sanitizeEdges(
  ctx: OntologyContext,
  objectId: string,
  edges: Array<{ label: string; targetIds: string[] }>
): Promise<OntologyObject["relationships"]> {
  const audience = await resolveOntologyAudience(ctx);
  const targetIds = edges.flatMap((e) => e.targetIds);
  const live = await repo.filterObjectIds(audience.workspaceIds, targetIds);
  const valid = await admittedObjectIds(
    ctx,
    audience,
    targetIds.filter((id) => live.has(id))
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
 * every update, claim_anchor, get_anchor). Never filter a whole-container read.
 *
 * 🔒 **AND THE FAR END IS FILTERED BY THE AUDIENCE, exactly as `getSnapshot`
 * drops an edge whose target it did not walk to.** A row written before this
 * fence existed — or by the OWNER, into their own private cluster — must not
 * hand a lent reader the raw id of an object they cannot open (spec R12's shape,
 * on this feature's own table). One batched walk, never one per edge.
 */
async function currentRelationships(
  ctx: OntologyContext,
  objectId: string
): Promise<OntologyObject["relationships"]> {
  const audience = await resolveOntologyAudience(ctx);
  const rows = await narrow.listRelationshipsForSource(
    audience.workspaceIds,
    objectId
  );
  const visible = await admittedObjectIds(
    ctx,
    audience,
    rows.map((r) => r.target_object_id)
  );
  const edges: OntologyObject["relationships"] = [];
  for (const r of rows) {
    if (!visible.has(r.target_object_id)) continue;
    const edge = edges.find((e) => e.label === r.label);
    if (edge) edge.targetIds.push(r.target_object_id);
    else edges.push({ label: r.label, targetIds: [r.target_object_id] });
  }
  return edges;
}

/** PERMANENTLY delete one object. Irreversible, no trash. Memberships and
 *  relationships cascade via FK. */
export async function deleteObject(
  ctx: OntologyContext,
  objectId: string
): Promise<void> {
  const gated = await requireObject(ctx, objectId, "edit");
  await repo.hardDeleteObject(gated.workspace_id, objectId);
}

/**
 * Link the caller's account to an object (their identity anchor).
 *
 * ⚠ THE ANCHOR STAYS SINGLE-CONTAINER (R9). The gate is the ordinary object
 * write gate, so a peer cannot anchor themselves to a row they may not edit;
 * the LINK itself is then written in the container the row lives in, which is
 * the same container the anchor read looks in.
 */
export async function claimAnchor(
  ctx: OntologyContext,
  objectId: string
): Promise<OntologyObject> {
  const gated = await requireObject(ctx, objectId, "edit");
  const row = await anchorRepo.setAnchor(gated.workspace_id, ctx.userId, objectId);
  if (!row) throw HttpError.notFound("Object not found");
  const object = mapObjectRow(row);
  object.relationships = await currentRelationships(ctx, objectId);
  return object;
}

/** Caller's identity anchor — object linked via `ontology_objects.user_id`,
 *  or null. ⚠ Re-gated as a READ (`view` on ANY cluster, Q9): an anchor whose
 *  object left this caller's audience answers `null`, the same as no anchor. */
export async function getAnchor(
  ctx: OntologyContext
): Promise<OntologyObject | null> {
  const row = await anchorRepo.findAnchorObject(ctx.workspaceId, ctx.userId);
  if (!row) return null;
  const visible = await requireObject(ctx, row.id, "view").catch(() => null);
  if (!visible) return null;
  const object = mapObjectRow(visible);
  object.relationships = await currentRelationships(ctx, row.id);
  return object;
}

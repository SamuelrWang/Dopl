import "server-only";
import { assertCanCreateObject } from "@/features/billing/server/entitlements";
import { HttpError } from "@/shared/lib/http-error";
import { slugify } from "@/shared/lib/slug/slugify";
import type { Role } from "@/features/workspaces/types";
import type {
  Ontology,
  OntologyContext,
  OntologyObject,
} from "../types";
import type {
  OntologyCreateInput,
  OntologyUpdateInput,
  OntologyObjectCreateInput,
  OntologyObjectUpdateInput,
} from "../schema";
import { mapObjectRow, pushEdge } from "./dto";
import * as repo from "./repository";
import * as anchorRepo from "./repository-anchor";
import * as narrow from "./repository-projections";
import { resolveOntologyAudience } from "./service-audience";
import {
  admittedObjectIds,
  assertCanCreateOntology,
  requireOntology,
  requireObject,
} from "./service-gates";
import { mapOntologyRow, getSnapshot, getSummary } from "./service-reads";
import { getReach } from "./service-reach";
// Awaited, after the write, inside the request (`./service-revisions.ts`).
import {
  edgeSnapshot,
  recordAnchorRevision,
  recordAssociationRevision,
  recordOntologyCreate,
  recordOntologyDelete,
  recordOntologyFieldChanges,
  recordMembershipCreate,
  recordObjectCreate,
  recordObjectDelete,
  recordObjectFieldChanges,
  type RecordFieldOpts,
} from "./service-revisions";

/**
 * Ontology business logic — WRITES, their gates, and the anchor. The two graph
 * READS live in `./service-reads.ts`, re-exported below so every caller keeps
 * importing them from here.
 *
 * Every write passes `./service-gates.ts` FIRST, and the gate returns the row.
 * A lent ontology lives in the LENDER's container, so each write targets
 * `row.workspace_id`: `ctx.workspaceId` would 404 a row the caller may edit
 * and, on a create, file it under the wrong tenancy.
 */

export { getSnapshot, getSummary, getReach };

interface AuthLike {
  workspaceId: string;
  userId: string;
  role: Role;
  agentTokenId?: string | null;
  /** WHOSE REACH the credential inherits; `null` = nobody in particular.
   *  Required — this axis has no safe default (F-336). */
  credentialSubjectUserId: string | null;
  sessionId?: string | null;
}

/**
 * `withWorkspaceAuth` (or the MCP equivalent) result → {@link OntologyContext}.
 * `source` derives from agent-token presence, as
 * `knowledge/server/service-shared.ts › buildKnowledgeContext` derives it.
 *
 * One context object per request is load-bearing: the ceiling is memoised
 * against this object's identity (`./service-audience.ts › AUDIENCE_CACHE`), so
 * two would resolve it twice and a module-level constant would share one
 * request's answer with the next.
 */
export function buildOntologyContext(auth: AuthLike): OntologyContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    role: auth.role,
    source: auth.agentTokenId ? "agent" : "user",
    credentialSubjectUserId: auth.credentialSubjectUserId,
    // Verbatim, and attribution only — the desktop's slot key and the one
    // forgeable field here (`shared/auth/session-header.ts`). The changelog
    // GROUPS an agent session's writes by it; nothing grants on it.
    sessionId: auth.sessionId ?? null,
  };
}

export async function createOntology(
  ctx: OntologyContext,
  input: OntologyCreateInput
): Promise<Ontology> {
  await assertCanCreateOntology(ctx);
  const slugs = await narrow.listOntologySlugs(ctx.workspaceId);
  const slug = slugify(input.name, "ontology", slugs);
  const row = await repo.insertOntology({
    workspaceId: ctx.workspaceId,
    slug,
    name: input.name,
    purpose: input.purpose ?? "",
    position: slugs.length,
    createdBy: ctx.userId,
    source: ctx.source,
  });
  await recordOntologyCreate(ctx, row);
  return mapOntologyRow(row);
}

export async function updateOntology(
  ctx: OntologyContext,
  ontologyId: string,
  input: OntologyUpdateInput
): Promise<Ontology> {
  const gated = await requireOntology(ctx, ontologyId, "edit");
  // Containment: the solo toggle decides what THIS SESSION's class may do, so
  // a session that could write it would be one call from re-widening itself
  // (`channels/[channelId]/members`' `agentToolProfile` argument, one layer lower
  // so the MCP path inherits it).
  if (input.agentsMayEdit !== undefined && ctx.source === "agent") {
    throw new HttpError(
      403,
      "ONTOLOGY_AGENT_SETTING_FORBIDDEN",
      "Whether your agents may edit this ontology is a human-only setting."
    );
  }
  const row = await repo.updateOntology(gated.workspace_id, ontologyId, input, {
    userId: ctx.userId,
    source: ctx.source,
  });
  if (!row) throw HttpError.notFound("Ontology not found");
  // `gated` is the BEFORE state, so the diff costs no second read. A
  // layout-only drag changes no TRACKED field and records nothing
  // (`./service-revisions.ts › ontologyFields`).
  await recordOntologyFieldChanges(ctx, gated, row);
  return mapOntologyRow(row);
}

/**
 * Cascade HARD-delete ontology + every object it owns, one atomic RPC.
 * Permanent: no trash/restore/purge. Must stay one transaction — two writes
 * can delete the objects and leave the ontology behind. Returns objects
 * cascaded; RPC null = no live ontology → 404 (≠ an ontology that owned 0).
 *
 * Q4 — the share rows cascade by FK (`ontology_channel_shares.ontology_id
 * ON DELETE CASCADE`, spec §3.1). Nothing here deletes them by hand: a
 * hand-written cascade beside a declared one is the copy that stops matching.
 */
export async function deleteOntology(
  ctx: OntologyContext,
  ontologyId: string
): Promise<number> {
  const gated = await requireOntology(ctx, ontologyId, "edit");
  const count = await repo.cascadeHardDeleteOntology(gated.workspace_id, ontologyId);
  if (count === null) throw HttpError.notFound("Ontology not found");
  await recordOntologyDelete(ctx, gated, count);
  return count;
}

export async function createObject(
  ctx: OntologyContext,
  input: OntologyObjectCreateInput
): Promise<OntologyObject> {
  // The write gate comes FIRST and decides the container: a column lands in
  // its ontology's, a card in its parent's. Q9 applies through `requireObject`
  // for the parent case — a card inherits the parent's ontology set, so the
  // parent's ALL-ontologies `edit` is the same question asked one row up.
  let workspaceId: string;
  let attributes: OntologyObject["attributes"] | undefined;
  let methods: OntologyObject["methods"] | undefined;
  let inheritedEdges: OntologyObject["relationships"] | undefined;
  if (input.ontologyId) {
    workspaceId = (await requireOntology(ctx, input.ontologyId, "edit")).workspace_id;
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
  // cards land here; createOntology inserts no object row so it isn't gated.
  // Freeze-don't-delete: only creation blocked, never updates/deletes/reads.
  // Billed to the ROW's container, which is the OWNER's when a peer creates
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
    input.ontologyId
      ? { ontologyId: input.ontologyId }
      : { parentObjectId: input.parentObjectId as string }
  );
  await repo.insertMembership({
    workspaceId,
    ontologyId: input.ontologyId ?? null,
    parentObjectId: input.parentObjectId ?? null,
    childObjectId: row.id,
    position,
  });
  if (inheritedEdges?.length) {
    await repo.replaceRelationshipsForSource(workspaceId, row.id, inheritedEdges);
  }
  await recordObjectCreate(ctx, row);
  await recordMembershipCreate(ctx, row, {
    ontologyId: input.ontologyId ?? null,
    parentObjectId: input.parentObjectId ?? null,
  });
  if (inheritedEdges?.length) {
    await recordAssociationRevision(
      ctx,
      { id: row.id, workspaceId },
      "relationship",
      [],
      edgeSnapshot(inheritedEdges)
    );
  }
  const object = mapObjectRow(row);
  object.relationships = inheritedEdges ?? [];
  return object;
}

/** 412 on optimistic-concurrency miss. Must mirror KB/skills
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

/** `revision` is the restore's door and nothing else writes it
 *  (`./service-revisions-read.ts › restoreObjectRevision`): a restore is an
 *  ordinary field write FILED as `op:"restore"`, and letting that path reach the
 *  repository instead would skip Q9's gate, the attribution stamp and the
 *  capture below. */
export async function updateObject(
  ctx: OntologyContext,
  objectId: string,
  input: OntologyObjectUpdateInput,
  expectedUpdatedAt?: string,
  revision: RecordFieldOpts = {}
): Promise<OntologyObject> {
  // Q9 — `edit` on EVERY ontology this object belongs to, before any write.
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
  let beforeEdges: OntologyObject["relationships"] | undefined;
  if (relationships) {
    // Read BEFORE the replace, and only on a relationship write: the capture
    // needs both ends and `replaceRelationshipsForSource` is destructive. The one
    // extra query this costs, on a path that already spends two.
    beforeEdges = await currentRelationships(ctx, objectId);
    cleanEdges = await sanitizeEdges(ctx, objectId, relationships);
    await repo.replaceRelationshipsForSource(workspaceId, objectId, cleanEdges);
    // Edge write bumps source `updated_at` via the ontology_relationships
    // trigger (H-4) → re-read for the post-bump version token, else caller's
    // next CAS write spuriously 412s.
    const refreshed = await repo.findObjectById(scope, objectId);
    if (refreshed) row = refreshed;
  }

  // `gated` is the BEFORE state — one row per field that MOVED, zero for a
  // PATCH that re-sent what was already stored.
  await recordObjectFieldChanges(ctx, gated, row, revision);
  if (beforeEdges) {
    await recordAssociationRevision(
      ctx,
      { id: row.id, workspaceId },
      "relationship",
      edgeSnapshot(beforeEdges),
      edgeSnapshot(cleanEdges ?? [])
    );
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
 * Targets are validated against the AUDIENCE'S ANSWER, not its scope, and the
 * difference is Q8. The scope holds the LENDER's whole container, so
 * `./repository.ts › filterObjectIds` alone would let somebody lent ONE ontology
 * point an edge at any row in that container — the "widens the scope and forgets
 * the filter" failure, arriving on a WRITE. `./service-gates.ts ›
 * admittedObjectIds` applies the ontology walk on top.
 *
 * It is still a `filter`, never a refusal: clients hold stale ids after a
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
 * One object's outbound edges. Scope in Postgres, not JS — `source_object_id`
 * is indexed, and this sits on four hot paths (inherited-edge copy at create,
 * every update, claim_anchor, get_anchor). Never filter a whole-container read.
 *
 * The far end is filtered by the audience, as `getSnapshot` drops an
 * edge whose target it did not walk to: a row written before this fence existed,
 * or by the OWNER into a private ontology, must not hand a lent reader the raw id
 * of an object they cannot open (spec R12). One batched walk, never one per
 * edge.
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
    pushEdge(edges, r.label, r.target_object_id);
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
  // After the delete, carrying the LAST state — the only place it survives.
  await recordObjectDelete(ctx, gated);
}

/** Link the caller's account to an object (their identity anchor). The anchor
 *  stays single-container (R9): the ordinary object write gate applies, and the
 *  link lands in the row's own container — the one the anchor read looks in. */
export async function claimAnchor(
  ctx: OntologyContext,
  objectId: string
): Promise<OntologyObject> {
  const gated = await requireObject(ctx, objectId, "edit");
  const row = await anchorRepo.setAnchor(gated.workspace_id, ctx.userId, objectId);
  if (!row) throw HttpError.notFound("Object not found");
  await recordAnchorRevision(ctx, row, gated.user_id);
  const object = mapObjectRow(row);
  object.relationships = await currentRelationships(ctx, objectId);
  return object;
}

/** Caller's identity anchor — object linked via `ontology_objects.user_id`,
 *  or null. Re-gated as a READ (`view` on ANY ontology, Q9): an anchor whose
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

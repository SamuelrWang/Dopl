import "server-only";
import { recordRevision } from "@/features/revisions/server/service";
import type { RevisionAssociation, RevisionOp } from "@/features/revisions/types";
import type { OntologyContext, OntologyObject, OntologyShare } from "../types";
import type { OntologyClusterRow, OntologyObjectRow } from "./dto";

/**
 * ONTOLOGY → REVISIONS: the CAPTURE half (2026-09-09, the CHANGELOG lane part 2,
 * closing `docs/REFACTOR-FINDINGS.md › F-686`).
 *
 * ⚠ **ONE REVISION PER CHANGED FIELD, NOT ONE PER SAVE, AND THAT IS A DIFFERENT
 * GRANULARITY FROM KNOWLEDGE'S.** Samuel's design (2026-09-09) is HubSpot-shaped:
 * per OBJECT, per FIELD, `old → new`, who, when, and whether a person or which
 * agent. `ontology_objects.attributes` is a JSONB bag, so one PATCH changes N
 * properties at once; recording one row per save would collapse exactly the
 * per-property timeline this exists for. The two granularities share one table
 * and one actor model and must never be described by one sentence in a doc.
 *
 * ⚠ **THE HUMAN COALESCING WINDOW DOES NOT APPLY HERE, AND IT IS THE PRIMITIVE
 * THAT SAYS SO** (`revisions/server/service.ts › COALESCING_RESOURCE_TYPES`), not
 * a flag this module passes. A field change is already atomic, and coalescing two
 * `edit` rows against one object would replace one FIELD's history with
 * another's.
 *
 * ⚠ **AWAITED, AFTER THE WRITE, INSIDE THE SAME REQUEST.** Never `void`-ed and
 * never caught-and-continued: a lost revision is a lost audit, so a write whose
 * revision could not be recorded is reported as FAILED
 * (`revisions/server/repository.ts` carries the full argument).
 *
 * ⚠ **CAPTURE ONLY.** The reads and the restore need `service-gates.ts` and the
 * object WRITE service, which import this module back;
 * `./service-revisions-read.ts` holds that half so the cycle is a seam rather
 * than an import order nobody can see. Same split, same reason, as the knowledge
 * lane's.
 */

/**
 * ⚠ **ONE ATTRIBUTE OF THE BAG IS SPELLED `attribute:<key>`, SO A BAG ENTRY CAN
 * NEVER COLLIDE WITH A COLUMN.** An attribute keyed `name` is a perfectly legal
 * thing for a user to add, and an unprefixed field name would then file its
 * history under the object's own `name`.
 */
export const ATTRIBUTE_FIELD_PREFIX = "attribute:";

export interface OntologyFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * The OBJECT's tracked fields, flattened.
 *
 * ⚠ **WHAT IS DELIBERATELY NOT ON THIS LIST**: `updated_at`, `last_edited_by`
 * and `last_edited_source` (they describe the write, and a revision already
 * records all three), and `user_id` — the anchor has its own row
 * ({@link recordAnchorRevision}) because it is a link to a PERSON rather than a
 * property of the object.
 *
 * ⚠ `methods` and `template` are WHOLE-LIST fields rather than one field per
 * entry. They are the object's DEFINITION (what it can do, what its children are
 * born with), edited as a list in one editor; the per-entry granularity F-686
 * asks for is about `attributes`, which is where the property values live.
 */
export function objectFields(
  row: Pick<OntologyObjectRow, "name" | "subtitle" | "attributes" | "methods" | "template">
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    name: row.name,
    subtitle: row.subtitle,
    methods: row.methods ?? [],
    template: row.template ?? [],
  };
  for (const attribute of row.attributes ?? []) {
    fields[`${ATTRIBUTE_FIELD_PREFIX}${attribute.key}`] = attribute.value;
  }
  return fields;
}

/**
 * The CLUSTER's tracked fields.
 *
 * ⚠ **`layout` IS NOT ONE, AND THAT IS THE WHOLE POINT OF THE DESIGN.** It is
 * one `{x,y}` per node, written on every drag-drop of a card — recording it
 * would make the changelog a mouse log wearing the word "revision", which is the
 * thing Samuel's design refuses ("it doesn't make sense to track every tiny
 * letter change"). ⚠ `slug` is not one either: it is DERIVED from the name at
 * create and never changes, so a row about it would restate the rename.
 */
export function clusterFields(
  row: Pick<OntologyClusterRow, "name" | "purpose" | "agents_may_edit">
): Record<string, unknown> {
  return {
    name: row.name,
    purpose: row.purpose,
    agentsMayEdit: row.agents_may_edit,
  };
}

/** Stable-order JSON, so two equal values compare equal however they were
 *  built. ⚠ Arrays keep their order — an attribute list reordered IS a change. */
function stable(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
      );
    }
    return v;
  });
}

/**
 * The fields that actually MOVED.
 *
 * ⚠ **A FIELD PRESENT ON ONE SIDE ONLY IS A CHANGE, AND ITS MISSING HALF IS
 * `null` RATHER THAN `undefined`** — an attribute added or removed is exactly
 * the event a property timeline exists to show, and `undefined` does not survive
 * `JSON.stringify` into a `jsonb` payload, so the row would arrive with the key
 * missing and read as "no value recorded".
 *
 * ⚠ **AN UNCHANGED FIELD RECORDS NOTHING.** A PATCH that re-sends what is
 * already stored is a no-op, and a no-op that files a revision shows the reader
 * an edit that never happened.
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): OntologyFieldChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: OntologyFieldChange[] = [];
  for (const field of keys) {
    const from = field in before ? before[field] : null;
    const to = field in after ? after[field] : null;
    if (stable(from) === stable(to)) continue;
    changes.push({ field, before: from ?? null, after: to ?? null });
  }
  return changes;
}

/**
 * ⚠ **`rename` IS THE OP FOR THE `name` FIELD AND `edit` FOR EVERY OTHER ONE.**
 * The primitive's vocabulary already has the word, the renderer already labels
 * it, and a rename is the one field change a reader scans a timeline for.
 */
function opForField(field: string): RevisionOp {
  return field === "name" ? "rename" : "edit";
}

export interface RecordFieldOpts {
  /** Forced op — `restore` when the write is writing a prior value back. */
  op?: RevisionOp;
  summary?: string | null;
}

/** ONE row per changed field, in field order, each awaited. Answers how many
 *  were recorded, which is what the capture tests count. */
async function recordFieldChanges(
  ctx: OntologyContext,
  resource: { resourceType: "ontology_object" | "ontology_cluster"; id: string; workspaceId: string },
  changes: readonly OntologyFieldChange[],
  opts: RecordFieldOpts = {}
): Promise<number> {
  for (const change of changes) {
    await recordRevision(ctx, {
      resourceType: resource.resourceType,
      resourceId: resource.id,
      // ⚠ THE RESOURCE'S OWN container, never `ctx.workspaceId`: a LENT
      // ontology lives in the lender's while the caller stands in the channel's,
      // and a row filed under the writer's container is invisible from the
      // cluster it is the history of (INVARIANTS §T35's id-following writes).
      workspaceId: resource.workspaceId,
      op: opts.op ?? opForField(change.field),
      summary: opts.summary ?? null,
      payload: { field: change.field, before: change.before, after: change.after },
    });
  }
  return changes.length;
}

// ─── Objects ────────────────────────────────────────────────────────

/** The object came into being — ONE `create` row carrying every initial field.
 *  ⚠ NOT N field rows: there is no `before` to diff against, and N rows would
 *  read as N edits of a thing that did not exist a moment earlier. */
export async function recordObjectCreate(
  ctx: OntologyContext,
  row: OntologyObjectRow
): Promise<void> {
  await recordRevision(ctx, {
    resourceType: "ontology_object",
    resourceId: row.id,
    workspaceId: row.workspace_id,
    op: "create",
    payload: { fields: objectFields(row) },
  });
}

/** A field patch — one row per field that MOVED, zero for a no-op. */
export async function recordObjectFieldChanges(
  ctx: OntologyContext,
  before: OntologyObjectRow,
  after: OntologyObjectRow,
  opts: RecordFieldOpts = {}
): Promise<number> {
  return recordFieldChanges(
    ctx,
    { resourceType: "ontology_object", id: after.id, workspaceId: after.workspace_id },
    changedFields(objectFields(before), objectFields(after)),
    opts
  );
}

/** Permanent removal — ONE `delete` row carrying the LAST state, which is the
 *  only place it survives (ontology deletes are hard, no trash). */
export async function recordObjectDelete(
  ctx: OntologyContext,
  row: OntologyObjectRow
): Promise<void> {
  await recordRevision(ctx, {
    resourceType: "ontology_object",
    resourceId: row.id,
    workspaceId: row.workspace_id,
    op: "delete",
    payload: { fields: objectFields(row) },
  });
}

/**
 * The identity ANCHOR — a link to a PERSON, filed as its own field row.
 * ⚠ It is not in {@link objectFields} because it is not a property of the
 * object; it is who the object IS, and a restore must never re-point it.
 */
export async function recordAnchorRevision(
  ctx: OntologyContext,
  row: OntologyObjectRow,
  before: string | null
): Promise<void> {
  if (before === row.user_id) return;
  await recordRevision(ctx, {
    resourceType: "ontology_object",
    resourceId: row.id,
    workspaceId: row.workspace_id,
    op: "edit",
    payload: {
      // ⚠ AN ASSOCIATION, NOT A FIELD, AND THE DISTINCTION IS LOAD-BEARING: the
      // anchor links this object to a PERSON, and `claimAnchor` anchors the
      // CALLER — so there is no write that could put somebody else's anchor
      // back, and a field-shaped row would draw a Restore button whose only
      // outcome is a refusal.
      association: "anchor",
      field: "anchor",
      before,
      after: row.user_id,
    },
  });
}

/**
 * AN ASSOCIATION — a relationship or a cluster/column membership — filed on the
 * OBJECT it attaches to.
 *
 * 🔒 ⚠ **`op` IS `edit`, NOT A NEW WORD.** `link`/`unlink` would require the
 * migration's `op` CHECK to grow, and this shape needs no schema change at all:
 * `payload.association` is what a renderer keys on and what the restore
 * predicate refuses (`revisions/lib/restorable.ts`). Recorded here rather than
 * as its own `resource_type` because neither edge is addressable — no reader can
 * ask a membership row for its history.
 *
 * ⚠ RECORDS NOTHING WHEN THE EDGE SET DID NOT MOVE.
 */
export async function recordAssociationRevision(
  ctx: OntologyContext,
  object: { id: string; workspaceId: string },
  association: RevisionAssociation,
  before: unknown,
  after: unknown
): Promise<number> {
  if (stable(before) === stable(after)) return 0;
  await recordRevision(ctx, {
    resourceType: "ontology_object",
    resourceId: object.id,
    workspaceId: object.workspaceId,
    op: "edit",
    payload: { association, field: association, before, after },
  });
  return 1;
}

/** The placement a create wrote — the object's first membership. */
export async function recordMembershipCreate(
  ctx: OntologyContext,
  row: OntologyObjectRow,
  placement: { clusterId: string | null; parentObjectId: string | null }
): Promise<void> {
  await recordAssociationRevision(
    ctx,
    { id: row.id, workspaceId: row.workspace_id },
    "membership",
    null,
    placement
  );
}

/** One object's outbound edges, as the payload states them. */
export function edgeSnapshot(
  edges: OntologyObject["relationships"]
): Array<{ label: string; targetIds: string[] }> {
  return edges.map((edge) => ({ label: edge.label, targetIds: [...edge.targetIds] }));
}

// ─── Clusters ───────────────────────────────────────────────────────

export async function recordClusterCreate(
  ctx: OntologyContext,
  row: OntologyClusterRow
): Promise<void> {
  await recordRevision(ctx, {
    resourceType: "ontology_cluster",
    resourceId: row.id,
    workspaceId: row.workspace_id,
    op: "create",
    payload: { fields: clusterFields(row) },
  });
}

export async function recordClusterFieldChanges(
  ctx: OntologyContext,
  before: OntologyClusterRow,
  after: OntologyClusterRow
): Promise<number> {
  return recordFieldChanges(
    ctx,
    { resourceType: "ontology_cluster", id: after.id, workspaceId: after.workspace_id },
    changedFields(clusterFields(before), clusterFields(after))
  );
}

/** The cascade delete — ONE row on the CLUSTER carrying its last state.
 *  ⚠ The objects it took with it record NOTHING: the RPC is one statement and
 *  the rows are gone, so a per-object row would be a claim this path cannot
 *  make honestly. The cluster's `delete` row is what the roll-up shows. */
export async function recordClusterDelete(
  ctx: OntologyContext,
  row: OntologyClusterRow,
  cascadedObjects: number
): Promise<void> {
  await recordRevision(ctx, {
    resourceType: "ontology_cluster",
    resourceId: row.id,
    workspaceId: row.workspace_id,
    op: "delete",
    payload: { fields: { ...clusterFields(row), cascadedObjects } },
  });
}

/**
 * A SHARE change — who else reaches this ontology, filed on the CLUSTER.
 *
 * ⚠ The payload carries the LEVELS and the channel id, never a channel NAME:
 * the row is read by whoever can read the cluster's history, and a name is a
 * value somebody else's container owns.
 */
export async function recordShareRevision(
  ctx: OntologyContext,
  cluster: { id: string; workspaceId: string },
  channelId: string,
  before: OntologyShare | null,
  after: OntologyShare | null
): Promise<number> {
  if (stable(before) === stable(after)) return 0;
  await recordRevision(ctx, {
    resourceType: "ontology_cluster",
    resourceId: cluster.id,
    workspaceId: cluster.workspaceId,
    op: "edit",
    payload: { association: "share", field: `share:${channelId}`, before, after },
  });
  return 1;
}

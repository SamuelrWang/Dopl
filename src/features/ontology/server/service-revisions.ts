import "server-only";
import { recordRevision } from "@/features/revisions/server/service";
import type { RevisionAssociation, RevisionOp } from "@/features/revisions/types";
import type { OntologyContext, OntologyObject, OntologyShare } from "../types";
import type { OntologyRow, OntologyObjectRow } from "./dto";

/**
 * ONTOLOGY → REVISIONS: the CAPTURE half (2026-09-09, the CHANGELOG lane part 2,
 * closing `docs/REFACTOR-FINDINGS.md › F-686`).
 *
 * One revision per CHANGED FIELD, not one per save — a different granularity
 * from knowledge's (Samuel 2026-09-09, HubSpot-shaped: per object, per field,
 * `old → new`, who, when, person or which agent). One PATCH changes N entries
 * of the `attributes` bag, so one row per save would collapse the per-property
 * timeline this exists for.
 *
 * The human coalescing window does not apply, and the primitive says so
 * (`revisions/server/service.ts › COALESCING_RESOURCE_TYPES`), not a flag this
 * module passes.
 *
 * Awaited, after the write, inside the same request — never `void`-ed, never
 * caught-and-continued (`revisions/server/repository.ts` carries the argument).
 *
 * Capture only. The reads and the restore need `./service-gates.ts` and the
 * object WRITE service, which import this module back;
 * `./service-revisions-read.ts` holds that half so the cycle is a visible seam.
 */

/** One bag entry is spelled `attribute:<key>`, so it can never collide with a
 *  column. An attribute keyed `name` is legal, and unprefixed it would file
 *  its history under the object's own `name`. */
export const ATTRIBUTE_FIELD_PREFIX = "attribute:";

export interface OntologyFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * The OBJECT's tracked fields, flattened.
 *
 * Deliberately not on this list: `updated_at`, `last_edited_by`,
 * `last_edited_source` (a revision already records all three), and `user_id` —
 * the anchor gets its own row ({@link recordAnchorRevision}) because it links to
 * a PERSON rather than being a property.
 *
 * `methods` and `template` are WHOLE-LIST fields: they are the object's
 * DEFINITION, edited as one list. F-686's per-entry granularity is about
 * `attributes`, where the property values live.
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
 * The ONTOLOGY's tracked fields.
 *
 * `layout` is not one — one `{x,y}` per node, written on every drag-drop;
 * recording it makes the changelog a mouse log (Samuel: it doesn't make sense
 * to track every tiny letter change). Nor `slug`: DERIVED from the name at
 * create and never changed, so a row about it would restate the rename.
 */
export function ontologyFields(
  row: Pick<OntologyRow, "name" | "purpose" | "agents_may_edit">
): Record<string, unknown> {
  return {
    name: row.name,
    purpose: row.purpose,
    agentsMayEdit: row.agents_may_edit,
  };
}

/** Stable-order JSON, so two equal values compare equal however they were
 *  built. Arrays keep their order — an attribute list reordered IS a change. */
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
 * Present on ONE SIDE ONLY is a change, and the missing half is `null`, not
 * `undefined` — `undefined` does not survive `JSON.stringify` into `jsonb`, so
 * the row would arrive keyless and read as "no value recorded".
 *
 * An unchanged field records nothing — a re-sent PATCH is a no-op, and a
 * no-op that files a revision shows an edit that never happened.
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

/** `rename` for the `name` field, `edit` for every other — a rename is the one
 *  field change a reader scans a timeline for, and both words already exist. */
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
  resource: { resourceType: "ontology_object" | "ontology"; id: string; workspaceId: string },
  changes: readonly OntologyFieldChange[],
  opts: RecordFieldOpts = {}
): Promise<number> {
  for (const change of changes) {
    await recordRevision(ctx, {
      resourceType: resource.resourceType,
      resourceId: resource.id,
      // The RESOURCE'S OWN container, never `ctx.workspaceId`: a LENT ontology
      // lives in the lender's, and a row filed under the writer's is invisible
      // from the ontology it is the history of (INVARIANTS §T35).
      workspaceId: resource.workspaceId,
      op: opts.op ?? opForField(change.field),
      summary: opts.summary ?? null,
      payload: { field: change.field, before: change.before, after: change.after },
    });
  }
  return changes.length;
}

/** ONE row carrying a WHOLE state — a create's initial fields, or a delete's
 *  last. NOT N field rows: a create has no `before` to diff against, and N
 *  rows would read as N edits of a thing that did not exist a moment earlier. */
async function recordBundle(
  ctx: OntologyContext,
  resourceType: "ontology_object" | "ontology",
  row: { id: string; workspace_id: string },
  op: "create" | "delete",
  fields: Record<string, unknown>
): Promise<void> {
  await recordRevision(ctx, {
    resourceType,
    resourceId: row.id,
    workspaceId: row.workspace_id,
    op,
    payload: { fields },
  });
}

// ─── Objects ────────────────────────────────────────────────────────

export async function recordObjectCreate(
  ctx: OntologyContext,
  row: OntologyObjectRow
): Promise<void> {
  await recordBundle(ctx, "ontology_object", row, "create", objectFields(row));
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

/** Permanent removal — the LAST state, which is the only place it survives
 *  (ontology deletes are hard, no trash). */
export async function recordObjectDelete(
  ctx: OntologyContext,
  row: OntologyObjectRow
): Promise<void> {
  await recordBundle(ctx, "ontology_object", row, "delete", objectFields(row));
}

/** The identity ANCHOR — a link to a PERSON, its own row rather than a member of
 *  {@link objectFields}: it is who the object IS, and a restore must never
 *  re-point it. */
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
      // An association, not a field: `claimAnchor` anchors the CALLER, so no
      // write could put somebody else's anchor back and a field-shaped row would
      // draw a Restore button whose only outcome is a refusal.
      association: "anchor",
      field: "anchor",
      before,
      after: row.user_id,
    },
  });
}

/**
 * AN ASSOCIATION — a relationship or an ontology/column membership — filed on the
 * OBJECT it attaches to.
 *
 * `op` is `edit`, not a new word: `link`/`unlink` would grow the migration's
 * `op` CHECK; `payload.association` needs no schema change and is what the
 * renderer keys on and the restore predicate refuses
 * (`revisions/lib/restorable.ts`). Filed on the OBJECT because neither edge is
 * addressable — no reader can ask a membership row for its history.
 *
 * Records nothing when the edge set did not move.
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
  placement: { ontologyId: string | null; parentObjectId: string | null }
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

// ─── Ontologies ───────────────────────────────────────────────────────

export async function recordOntologyCreate(
  ctx: OntologyContext,
  row: OntologyRow
): Promise<void> {
  await recordBundle(ctx, "ontology", row, "create", ontologyFields(row));
}

export async function recordOntologyFieldChanges(
  ctx: OntologyContext,
  before: OntologyRow,
  after: OntologyRow
): Promise<number> {
  return recordFieldChanges(
    ctx,
    { resourceType: "ontology", id: after.id, workspaceId: after.workspace_id },
    changedFields(ontologyFields(before), ontologyFields(after))
  );
}

/** The cascade delete — ONE row on the ONTOLOGY carrying its last state.
 *  The objects it took with it record NOTHING: the RPC is one statement and
 *  the rows are gone, so a per-object row would be a claim this path cannot
 *  make honestly. The ontology's `delete` row is what the roll-up shows. */
export async function recordOntologyDelete(
  ctx: OntologyContext,
  row: OntologyRow,
  cascadedObjects: number
): Promise<void> {
  await recordBundle(ctx, "ontology", row, "delete", {
    ...ontologyFields(row),
    cascadedObjects,
  });
}

/**
 * A SHARE change — who else reaches this ontology, filed on the ONTOLOGY.
 *
 * Levels and the channel id, never a channel NAME: this row is read by whoever
 * can read the ontology's history, and a name belongs to somebody else's
 * container.
 */
export async function recordShareRevision(
  ctx: OntologyContext,
  ontology: { id: string; workspaceId: string },
  channelId: string,
  before: OntologyShare | null,
  after: OntologyShare | null
): Promise<number> {
  if (stable(before) === stable(after)) return 0;
  await recordRevision(ctx, {
    resourceType: "ontology",
    resourceId: ontology.id,
    workspaceId: ontology.workspaceId,
    op: "edit",
    payload: { association: "share", field: `share:${channelId}`, before, after },
  });
  return 1;
}

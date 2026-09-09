import "server-only";
import {
  listRevisions,
  listRevisionsAcross,
  restoreRevision,
  restoreSummary,
  type ListRevisionsOpts,
} from "@/features/revisions/server/service";
import { revisionReach } from "@/features/revisions/server/service-shared";
import {
  RevisionNotFoundError,
  RevisionNotRestorableError,
} from "@/features/revisions/server/errors";
import type { Revision, RevisionPage } from "@/features/revisions/types";
import type { OntologyContext } from "../types";
import { OntologyObjectUpdateSchema, type OntologyObjectUpdateInput } from "../schema";
import type { OntologyObjectRow } from "./dto";
import * as repo from "./repository";
import { requireCluster, requireObject } from "./service-gates";
import { resolveOntologyAudience } from "./service-audience";
import { walkAdmittedClusters } from "./service-reads";
import { ATTRIBUTE_FIELD_PREFIX } from "./service-revisions";
import { updateObject } from "./service";

/**
 * ONTOLOGY → REVISIONS: the READ half — one object's history, the CLUSTER
 * ROLL-UP, and the PER-FIELD restore.
 *
 * ⚠ **SPLIT FROM `./service-revisions.ts` BY A CYCLE, NOT BY SIZE.** The capture
 * half is imported BY the writers (`service.ts`, `service-shares.ts`); this half
 * imports those same writers back, to gate a read and to perform a restore.
 *
 * 🔒 ⚠ **EVERY READ IS GATED BY THE ONTOLOGY'S OWN GATES FIRST, AND THE PROOF IS
 * PASSED ON AS A REACH SET.** `revisions` states no visibility rule of its own
 * (`revisions/server/service-shared.ts`), and the query behind it runs as service
 * role — so a history read that skipped `requireObject` / `requireCluster` would
 * be an unfenced read of an append-only table holding every container's writes.
 * A refusal is that gate's 404, so "no such object", "not shared with you" and
 * "no history" stay ONE answer (`service-gates.ts`'s rule).
 */

/**
 * ONE object's history, newest first.
 *
 * 🔒 GATED AT `view` — Q9's read half (`view` on ANY cluster the object belongs
 * to), the same door `GET /api/ontology` opens for the object itself.
 */
export async function listObjectRevisions(
  ctx: OntologyContext,
  objectId: string,
  opts: ListRevisionsOpts = {}
): Promise<RevisionPage> {
  const row = await requireObject(ctx, objectId, "view");
  const ref = { resourceType: "ontology_object" as const, resourceId: row.id };
  return listRevisions(ref, revisionReach([ref]), opts);
}

/**
 * THE CLUSTER ROLL-UP — every revision of the ontology itself and of every
 * object in it, newest first. This is what the /home card's **Changelog**
 * renders, day-grouped by the renderer.
 *
 * 🔒 GATED ON `requireCluster(ctx, id, "view")`, then narrowed to the ids the
 * cluster's OWN membership walk produces. ⚠ **THE ID SET IS THE FENCE** and the
 * reach set is the belt: the walk is the SAME one `service-reads.ts ›
 * getSnapshot` uses (Q8 — the cluster's membership walk IS the boundary), so an
 * object reachable only from another cluster is not in this history even though
 * the query ran as service role.
 *
 * ⚠ **A DELETED OBJECT'S ROWS ARE FILED AND NOT SHOWN.** Ontology deletes are
 * permanent, so a `delete` revision names an id no walk can still produce. That
 * is the fail-closed direction and the SAME answer the RLS policy gives once the
 * row is gone (`20261002120000_revisions.sql`); the CLUSTER's own rows are
 * unaffected, so a cascade delete still shows on the cluster.
 */
export async function listClusterRevisions(
  ctx: OntologyContext,
  clusterId: string,
  opts: ListRevisionsOpts = {}
): Promise<RevisionPage> {
  const cluster = await requireCluster(ctx, clusterId, "view");
  const audience = await resolveOntologyAudience(ctx);
  const memberships = await repo.listMemberships(audience.workspaceIds);
  const walk = walkAdmittedClusters(new Set([cluster.id]), memberships);
  const refs = [
    { resourceType: "ontology_cluster" as const, resourceId: cluster.id },
    ...walk.objectIds.map((id) => ({
      resourceType: "ontology_object" as const,
      resourceId: id,
    })),
  ];
  return listRevisionsAcross(cluster.workspace_id, refs, revisionReach(refs), opts);
}

/**
 * 🔒 **PER-FIELD RESTORE — A NEW REVISION, NEVER A REWRITE.**
 *
 * Samuel's design: restore is per FIELD. The `before` value of ONE revision is
 * written back through {@link updateObject} — the object's own write service —
 * which re-runs Q9's every-cluster `edit` gate, the attribution stamp and the
 * optimistic-concurrency path, and records the resulting field revision itself
 * with `op: "restore"`. Nothing here touches the source row or any row between
 * it and now.
 *
 * 🔒 **REFUSED AT `view`.** The gate is `requireObject(ctx, objectId, "edit")` —
 * a restore IS an edit and earns neither a lower floor nor a higher one — so a
 * lent reader whose channel grants `view` gets the same 404 every other write
 * gives them.
 *
 * ⚠ A revision belonging to a DIFFERENT object is the same 404 an unknown id
 * gets: the route addresses one object, and letting it write another object's
 * value would make the object id decorative.
 *
 * ⚠ **AGENTS MAY RESTORE** — deliberately not `sessionOnly`. That gate is for
 * acts that DESTROY; a restore appends a revision whose value already happened,
 * and the solo toggle plus the share level are the fences that apply.
 */
export async function restoreObjectRevision(
  ctx: OntologyContext,
  objectId: string,
  revisionId: string
): Promise<void> {
  const row = await requireObject(ctx, objectId, "edit");
  const reach = revisionReach([
    { resourceType: "ontology_object", resourceId: row.id },
  ]);
  await restoreRevision(revisionId, reach, async (source) => {
    if (source.resourceId !== row.id) throw new RevisionNotFoundError(revisionId);
    await updateObject(ctx, row.id, restorePatch(row, source, revisionId), undefined, {
      op: "restore",
      summary: restoreSummary(source),
    });
  });
}

/**
 * The patch that writes ONE field's prior value back.
 *
 * ⚠ **IT IS PARSED THROUGH THE OBJECT'S OWN WRITE SCHEMA, NOT TRUSTED.** The
 * `before` half of a revision is JSON that has sat in a `jsonb` column since a
 * schema older than today's — an oversized string, a `kind` that no longer
 * exists, a shape written by a build that has shipped since. A stored value that
 * no longer validates is `REVISION_NOT_RESTORABLE` (409), which is what the UI
 * already knows how to say; writing it unchecked would put a row into the table
 * that every later read has to defend against.
 *
 * ⚠ **AN ATTRIBUTE RESTORE IS A MERGE, NOT A REPLACEMENT OF THE BAG.** The other
 * properties are somebody else's current values and a restore of ONE property
 * must not roll them back — that is the whole difference between a per-field
 * timeline and a document version. `before: null` means the property did not
 * exist then, so it is DROPPED rather than written as an empty value.
 */
function restorePatch(
  row: OntologyObjectRow,
  source: Revision,
  revisionId: string
): OntologyObjectUpdateInput {
  const field = source.payload.field as string;
  const before = source.payload.before;
  const draft: Record<string, unknown> = {};
  if (field === "name" || field === "subtitle") {
    draft[field] = before ?? "";
  } else if (field === "methods" || field === "template") {
    draft[field] = before ?? [];
  } else if (field.startsWith(ATTRIBUTE_FIELD_PREFIX)) {
    const key = field.slice(ATTRIBUTE_FIELD_PREFIX.length);
    const current = row.attributes ?? [];
    draft.attributes =
      before === null || before === undefined
        ? current.filter((a) => a.key !== key)
        : current.some((a) => a.key === key)
          ? current.map((a) =>
              a.key === key ? { ...a, value: before as (typeof a)["value"] } : a
            )
          : [...current, { key, label: key, value: before as never }];
  } else {
    // ⚠ An association row, a `create`/`delete` bundle, or a field this build no
    // longer writes. `restorable.ts` already refused the first two before the
    // writer ran; this is the arm that catches the third rather than silently
    // writing an empty patch and reporting success.
    throw new RevisionNotRestorableError(revisionId);
  }
  const parsed = OntologyObjectUpdateSchema.safeParse(draft);
  if (!parsed.success) throw new RevisionNotRestorableError(revisionId);
  return parsed.data;
}

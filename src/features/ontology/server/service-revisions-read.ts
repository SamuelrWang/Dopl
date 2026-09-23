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
 * Split from `./service-revisions.ts` by a cycle, not by size: the capture
 * half is imported BY the writers; this half imports those writers back.
 *
 * Every read passes the ontology's own gates first, and the proof is passed
 * on as a reach set. `revisions` states no visibility rule of its own
 * and its query runs as service role, so a read that skipped `requireObject` /
 * `requireCluster` would be an unfenced read of every container's writes. A
 * refusal is that gate's 404 (`./service-gates.ts`'s rule).
 */

/** ONE object's history, newest first. Gated at `view` — Q9's read half, the
 *  same door `GET /api/ontology` opens for the object itself. */
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
 * The cluster roll-up — every revision of the ontology and of every object in
 * it, newest first. What the /home card's Changelog renders.
 *
 * Gated on `requireCluster(ctx, id, "view")`, then narrowed to the ids the
 * cluster's OWN membership walk produces. The id set is the fence, the
 * reach set the belt: the walk is the SAME one `./service-reads.ts ›
 * walkAdmittedClusters` gives `getSnapshot` (Q8), so an object reachable only
 * from another cluster is absent even though the query ran as service role.
 *
 * A deleted object's rows are filed and not shown — a `delete` revision
 * names an id no walk can still produce, which is the fail-closed direction and
 * the RLS policy's own answer (`20261002120000_revisions.sql`). The CLUSTER's
 * rows are unaffected, so a cascade delete still shows on the cluster.
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
 * Per-field restore — a NEW revision, never a rewrite. Samuel's design:
 * restore is per FIELD. ONE revision's `before` goes back through
 * {@link updateObject}, which re-runs Q9's every-cluster `edit` gate, the
 * attribution stamp and the CAS path, and records the resulting revision with
 * `op: "restore"`. Nothing here touches the source row or any row since.
 *
 * Refused at `view` — a restore IS an edit and earns neither a lower floor
 * nor a higher one, so a lent `view` reader gets every other write's 404.
 *
 * A revision belonging to a DIFFERENT object is that same 404: letting the
 * route write another object's value would make the object id decorative.
 *
 * Agents may restore — deliberately not `sessionOnly`, which is for acts
 * that DESTROY. The solo toggle and the share level are the fences that apply.
 */
export async function restoreObjectRevision(
  ctx: OntologyContext,
  objectId: string,
  revisionId: string,
  /** The `X-Updated-At` precondition — the object's Version. Stale → 412; absent → last writer wins. */
  expectedUpdatedAt?: string
): Promise<void> {
  const row = await requireObject(ctx, objectId, "edit");
  const reach = revisionReach([
    { resourceType: "ontology_object", resourceId: row.id },
  ]);
  await restoreRevision(revisionId, reach, async (source) => {
    if (source.resourceId !== row.id) throw new RevisionNotFoundError(revisionId);
    await updateObject(ctx, row.id, restorePatch(row, source, revisionId), expectedUpdatedAt, {
      op: "restore",
      summary: restoreSummary(source),
    });
  });
}

/**
 * The patch that writes ONE field's prior value back.
 *
 * Parsed through the object's own write schema, not trusted. A revision's
 * `before` is JSON stored under a schema older than today's; one that no longer
 * validates is `REVISION_NOT_RESTORABLE` (409) rather than a row every later
 * read has to defend against.
 *
 * An attribute restore is a MERGE, not a replacement of the bag — the
 * other properties are current values and must not roll back with it. `before:
 * null` means the property did not exist, so it is DROPPED.
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
    // An association row, a `create`/`delete` bundle, or a field this build no
    // longer writes. `revisions/lib/restorable.ts` refused the first two before
    // the writer ran; this arm catches the third rather than writing an empty
    // patch and reporting success.
    throw new RevisionNotRestorableError(revisionId);
  }
  const parsed = OntologyObjectUpdateSchema.safeParse(draft);
  if (!parsed.success) throw new RevisionNotRestorableError(revisionId);
  return parsed.data;
}

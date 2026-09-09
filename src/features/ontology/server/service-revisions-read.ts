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
 * ⚠ **SPLIT FROM `./service-revisions.ts` BY A CYCLE, NOT BY SIZE**: the capture
 * half is imported BY the writers; this half imports those writers back.
 *
 * 🔒 ⚠ **EVERY READ PASSES THE ONTOLOGY'S OWN GATES FIRST, AND THE PROOF IS
 * PASSED ON AS A REACH SET.** `revisions` states no visibility rule of its own
 * and its query runs as service role, so a read that skipped `requireObject` /
 * `requireCluster` would be an unfenced read of every container's writes. A
 * refusal is that gate's 404 (`./service-gates.ts`'s rule).
 */

/** ONE object's history, newest first. 🔒 GATED AT `view` — Q9's read half, the
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
 * THE CLUSTER ROLL-UP — every revision of the ontology and of every object in it,
 * newest first. What the /home card's **Changelog** renders.
 *
 * 🔒 GATED ON `requireCluster(ctx, id, "view")`, then narrowed to the ids the
 * cluster's OWN membership walk produces. ⚠ **THE ID SET IS THE FENCE**, the
 * reach set the belt: the walk is the SAME one `./service-reads.ts ›
 * walkAdmittedClusters` gives `getSnapshot` (Q8), so an object reachable only
 * from another cluster is absent even though the query ran as service role.
 *
 * ⚠ **A DELETED OBJECT'S ROWS ARE FILED AND NOT SHOWN** — a `delete` revision
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
 * 🔒 **PER-FIELD RESTORE — A NEW REVISION, NEVER A REWRITE.** Samuel's design:
 * restore is per FIELD. ONE revision's `before` goes back through
 * {@link updateObject}, which re-runs Q9's every-cluster `edit` gate, the
 * attribution stamp and the CAS path, and records the resulting revision with
 * `op: "restore"`. Nothing here touches the source row or any row since.
 *
 * 🔒 **REFUSED AT `view`** — a restore IS an edit and earns neither a lower floor
 * nor a higher one, so a lent `view` reader gets every other write's 404.
 *
 * ⚠ A revision belonging to a DIFFERENT object is that same 404: letting the
 * route write another object's value would make the object id decorative.
 *
 * ⚠ **AGENTS MAY RESTORE** — deliberately not `sessionOnly`, which is for acts
 * that DESTROY. The solo toggle and the share level are the fences that apply.
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
 * ⚠ **PARSED THROUGH THE OBJECT'S OWN WRITE SCHEMA, NOT TRUSTED.** A revision's
 * `before` is JSON stored under a schema older than today's; one that no longer
 * validates is `REVISION_NOT_RESTORABLE` (409) rather than a row every later
 * read has to defend against.
 *
 * ⚠ **AN ATTRIBUTE RESTORE IS A MERGE, NOT A REPLACEMENT OF THE BAG** — the
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
    // ⚠ An association row, a `create`/`delete` bundle, or a field this build no
    // longer writes. `revisions/lib/restorable.ts` refused the first two before
    // the writer ran; this arm catches the third rather than writing an empty
    // patch and reporting success.
    throw new RevisionNotRestorableError(revisionId);
  }
  const parsed = OntologyObjectUpdateSchema.safeParse(draft);
  if (!parsed.success) throw new RevisionNotRestorableError(revisionId);
  return parsed.data;
}

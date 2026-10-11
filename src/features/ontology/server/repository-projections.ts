import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Clipped } from "@/shared/supabase/max-rows";
import { emptyWalk, walkedRead } from "./repository-paging";
import {
  ONTOLOGY_SUMMARY_COLS,
  ONTOLOGY_OBJECT_SUMMARY_COLS,
  ONTOLOGY_READ_LIMITS,
  ONTOLOGY_RELATIONSHIP_COLS,
  type OntologyListItemRow,
  type OntologyMembershipRow,
  type OntologyObjectSummaryRow,
  type OntologyRelationshipRow,
} from "./dto";

/**
 * Narrow reads — the rows `repository.ts` returns, minus columns/rows the
 * caller was never going to look at. Each exists because its wide sibling let
 * the cost of a read be set by the size of the WORKSPACE, not of the answer.
 * Same layer, same rules as `repository.ts`: raw Supabase I/O, no business
 * logic, every query filtered by `workspace_id` (service-role bypasses RLS).
 *
 * And the same workspace SET — `repository.ts`'s header carries the
 * argument in full: the set is a READ SCOPE, `levelForOntology` is the
 * authorization, and the object read below takes the ids the membership walk
 * produced rather than a container.
 *
 * 🔒 **AND THE SAME RANGE WALK** (Samuel #2935) — `repository.ts`'s header
 * carries the finding: `max_rows` clipped every one of these at 1,000 rows
 * silently, `ONTOLOGY_READ_LIMITS` is now the `hardCap` of a
 * `readAllPages` loop, the return is `Clipped<Row>`, and every paged read
 * tie-breaks its order on `id` so paging can neither duplicate nor skip a row.
 */

/** Ontologies for a map-shaped read: no `layout`. `layout` is one `{x,y}` per
 *  node — the largest field on a busy row, and useless off the canvas. */
export async function listOntologySummaries(
  workspaceIds: readonly string[]
): Promise<Clipped<OntologyListItemRow>> {
  if (workspaceIds.length === 0) return emptyWalk();
  const db = supabaseAdmin();
  return walkedRead<OntologyListItemRow>(
    (from, to) =>
      db
        .from("ontologies")
        .select(ONTOLOGY_SUMMARY_COLS)
        .in("workspace_id", workspaceIds)
        .is("deleted_at", null)
        .order("position")
        .order("created_at")
        .order("id")
        .range(from, to),
    ONTOLOGY_READ_LIMITS.ontologies
  );
}

/** Objects for a map-shaped read: id, name, subtitle. No `attributes`/
 *  `methods`/`template` — all of an ontology's bytes, none of its routing. */
export async function listObjectSummariesByIds(
  workspaceIds: readonly string[],
  ids: readonly string[]
): Promise<Clipped<OntologyObjectSummaryRow>> {
  if (workspaceIds.length === 0 || ids.length === 0) return emptyWalk();
  const db = supabaseAdmin();
  // ⚠ `.order("id")` is NEW — this read had no order, and `dopl_map` is the
  // surface every agent calls FIRST, so a duplicated-and-skipped page here is a
  // routing answer with objects missing from it.
  return walkedRead<OntologyObjectSummaryRow>(
    (from, to) =>
      db
        .from("ontology_objects")
        .select(ONTOLOGY_OBJECT_SUMMARY_COLS)
        .in("workspace_id", workspaceIds)
        .in("id", ids)
        .is("deleted_at", null)
        .order("id")
        .range(from, to),
    ONTOLOGY_READ_LIMITS.objects
  );
}

/** Just the slugs, for `createOntology`'s uniqueness check. ONE container,
 *  never the audience set: a create lands in the container it names, and the
 *  slug it must not collide with is that container's. Not `listOntologies`
 *  — that drags every ontology's `layout` over the wire to compare strings. */
export async function listOntologySlugs(
  workspaceId: string
): Promise<Clipped<string>> {
  const db = supabaseAdmin();
  // ⚠ Paged like the rest, and this one is a CORRECTNESS read, not a display
  // one: a short list is a slug `slugify` thinks is free, so the clip would
  // hand a new ontology a slug that already exists. `id` orders it (the select
  // is one column; PostgREST orders on columns it does not return).
  const { rows, truncated } = await walkedRead<{ slug: string }>(
    (from, to) =>
      db
        .from("ontologies")
        .select("slug")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("id")
        .range(from, to),
    ONTOLOGY_READ_LIMITS.ontologies
  );
  return { rows: rows.map((row) => row.slug), truncated };
}

/** One object's outbound edges, filtered in Postgres. `source_object_id` is
 *  indexed — never scan `listRelationships` in JS for this. */
export async function listRelationshipsForSource(
  workspaceIds: readonly string[],
  sourceObjectId: string
): Promise<Clipped<OntologyRelationshipRow>> {
  if (workspaceIds.length === 0) return emptyWalk();
  const db = supabaseAdmin();
  return walkedRead<OntologyRelationshipRow>(
    (from, to) =>
      db
        .from("ontology_relationships")
        .select(ONTOLOGY_RELATIONSHIP_COLS)
        .in("workspace_id", workspaceIds)
        .eq("source_object_id", sourceObjectId)
        .order("position")
        .order("created_at")
        .order("id")
        .range(from, to),
    ONTOLOGY_READ_LIMITS.relationships
  );
}

/**
 * The membership rows POINTING AT `childObjectIds` — one level UP the graph.
 * The step `service-gates.ts › ontologiesOfObject` iterates to answer Q9's "every
 * ontology this object belongs to".
 *
 * Narrow on purpose: three columns, no `position`, no `id`. The walk reads
 * the edge, never the row.
 */
export async function listMembershipParents(
  workspaceIds: readonly string[],
  childObjectIds: readonly string[]
): Promise<Clipped<MembershipParentRow>> {
  if (workspaceIds.length === 0 || childObjectIds.length === 0) return emptyWalk();
  const db = supabaseAdmin();
  // ⚠ `.order("id")` is NEW (no order before) and `id` is NOT in the select:
  // the walk reads the edge, never the row, but paging still needs a total order
  // and the PK is the only unique column here.
  // ⚠ And this one is a GATE's input (`service-gates.ts › ontologiesOfObjects`):
  // a clipped parent set answers "this object belongs to no ontology", which Q9
  // reads as a refusal — so the clip showed up as a phantom 404.
  return walkedRead<MembershipParentRow>(
    (from, to) =>
      db
        .from("ontology_memberships")
        .select("ontology_id, parent_object_id, child_object_id")
        .in("workspace_id", workspaceIds)
        .in("child_object_id", childObjectIds)
        .order("id")
        .range(from, to),
    ONTOLOGY_READ_LIMITS.memberships
  );
}

/** The three columns {@link listMembershipParents} returns — named so the
 *  `Clipped<>` signature stays readable. */
export type MembershipParentRow = Pick<
  OntologyMembershipRow,
  "ontology_id" | "parent_object_id" | "child_object_id"
>;

import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
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
 */

/** Ontologies for a map-shaped read: no `layout`. `layout` is one `{x,y}` per
 *  node — the largest field on a busy row, and useless off the canvas. */
export async function listOntologySummaries(
  workspaceIds: readonly string[]
): Promise<OntologyListItemRow[]> {
  if (workspaceIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontologies")
    .select(ONTOLOGY_SUMMARY_COLS)
    .in("workspace_id", workspaceIds)
    .is("deleted_at", null)
    .order("position")
    .order("created_at")
    .limit(ONTOLOGY_READ_LIMITS.ontologies);
  if (error) throw error;
  return (data ?? []) as OntologyListItemRow[];
}

/** Objects for a map-shaped read: id, name, subtitle. No `attributes`/
 *  `methods`/`template` — all of an ontology's bytes, none of its routing. */
export async function listObjectSummariesByIds(
  workspaceIds: readonly string[],
  ids: readonly string[]
): Promise<OntologyObjectSummaryRow[]> {
  if (workspaceIds.length === 0 || ids.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .select(ONTOLOGY_OBJECT_SUMMARY_COLS)
    .in("workspace_id", workspaceIds)
    .in("id", ids)
    .is("deleted_at", null)
    .limit(ONTOLOGY_READ_LIMITS.objects);
  if (error) throw error;
  return (data ?? []) as OntologyObjectSummaryRow[];
}

/** Just the slugs, for `createOntology`'s uniqueness check. ONE container,
 *  never the audience set: a create lands in the container it names, and the
 *  slug it must not collide with is that container's. Not `listOntologies`
 *  — that drags every ontology's `layout` over the wire to compare strings. */
export async function listOntologySlugs(workspaceId: string): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontologies")
    .select("slug")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .limit(ONTOLOGY_READ_LIMITS.ontologies);
  if (error) throw error;
  return (data ?? []).map((row) => row.slug as string);
}

/** One object's outbound edges, filtered in Postgres. `source_object_id` is
 *  indexed — never scan `listRelationships` in JS for this. */
export async function listRelationshipsForSource(
  workspaceIds: readonly string[],
  sourceObjectId: string
): Promise<OntologyRelationshipRow[]> {
  if (workspaceIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_relationships")
    .select(ONTOLOGY_RELATIONSHIP_COLS)
    .in("workspace_id", workspaceIds)
    .eq("source_object_id", sourceObjectId)
    .order("position")
    .order("created_at")
    .limit(ONTOLOGY_READ_LIMITS.relationships);
  if (error) throw error;
  return (data ?? []) as OntologyRelationshipRow[];
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
): Promise<
  Pick<OntologyMembershipRow, "ontology_id" | "parent_object_id" | "child_object_id">[]
> {
  if (workspaceIds.length === 0 || childObjectIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_memberships")
    .select("ontology_id, parent_object_id, child_object_id")
    .in("workspace_id", workspaceIds)
    .in("child_object_id", childObjectIds)
    .limit(ONTOLOGY_READ_LIMITS.memberships);
  if (error) throw error;
  return (data ?? []) as Pick<
    OntologyMembershipRow,
    "ontology_id" | "parent_object_id" | "child_object_id"
  >[];
}

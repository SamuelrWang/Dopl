import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  ONTOLOGY_CLUSTER_SUMMARY_COLS,
  ONTOLOGY_OBJECT_SUMMARY_COLS,
  ONTOLOGY_READ_LIMITS,
  ONTOLOGY_RELATIONSHIP_COLS,
  type OntologyClusterSummaryRow,
  type OntologyObjectSummaryRow,
  type OntologyRelationshipRow,
} from "./dto";

/**
 * NARROW READS — the rows `repository.ts` returns, minus columns/rows the
 * caller was never going to look at. Each exists because its wide sibling let
 * the cost of a read be set by the size of the WORKSPACE, not of the answer.
 * Same layer, same rules as `repository.ts`: raw Supabase I/O, no business
 * logic, every query filtered by `workspace_id` (service-role bypasses RLS).
 */

/** Clusters for a map-shaped read: no `layout`. `layout` is one `{x,y}` per
 *  node — the largest field on a busy row, and useless off the canvas. */
export async function listClusterSummaries(
  workspaceId: string
): Promise<OntologyClusterSummaryRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_clusters")
    .select(ONTOLOGY_CLUSTER_SUMMARY_COLS)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("position")
    .order("created_at")
    .limit(ONTOLOGY_READ_LIMITS.clusters);
  if (error) throw error;
  return (data ?? []) as OntologyClusterSummaryRow[];
}

/** Objects for a map-shaped read: id, name, subtitle. No `attributes`/
 *  `methods`/`template` — all of an ontology's bytes, none of its routing. */
export async function listObjectSummaries(
  workspaceId: string
): Promise<OntologyObjectSummaryRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .select(ONTOLOGY_OBJECT_SUMMARY_COLS)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .limit(ONTOLOGY_READ_LIMITS.objects);
  if (error) throw error;
  return (data ?? []) as OntologyObjectSummaryRow[];
}

/** Just the slugs, for `createCluster`'s uniqueness check. ⚠ Not `listClusters`
 *  — that drags every cluster's `layout` over the wire to compare strings. */
export async function listClusterSlugs(workspaceId: string): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_clusters")
    .select("slug")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .limit(ONTOLOGY_READ_LIMITS.clusters);
  if (error) throw error;
  return (data ?? []).map((row) => row.slug as string);
}

/** One object's outbound edges, filtered in Postgres. ⚠ `source_object_id` is
 *  indexed — never scan `listRelationships` in JS for this. */
export async function listRelationshipsForSource(
  workspaceId: string,
  sourceObjectId: string
): Promise<OntologyRelationshipRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_relationships")
    .select(ONTOLOGY_RELATIONSHIP_COLS)
    .eq("workspace_id", workspaceId)
    .eq("source_object_id", sourceObjectId)
    .order("position")
    .order("created_at")
    .limit(ONTOLOGY_READ_LIMITS.relationships);
  if (error) throw error;
  return (data ?? []) as OntologyRelationshipRow[];
}

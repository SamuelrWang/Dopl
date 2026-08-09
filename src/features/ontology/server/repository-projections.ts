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
 * NARROW READS for the ontology feature — the same rows `repository.ts`
 * returns, minus columns or rows the caller was never going to look at.
 *
 * It is a separate module for two reasons. `repository.ts` sits at 483 lines
 * against a hard 500 cap with its lint exemption removed (§2), so it has no
 * room; and these four queries share a single reason to exist that the wide
 * ones do not — each one replaces a read whose cost was set by the size of the
 * workspace rather than by the size of the answer. Same layer, same rules as
 * `repository.ts`: raw Supabase I/O, no business logic, every query filtered by
 * `workspace_id` because the service-role client bypasses RLS.
 */

/**
 * Clusters for a map-shaped read: no `layout`.
 *
 * `layout` is one `{x, y}` per node in the cluster, written by dragging cards
 * on the graph view. It is meaningless to anything that is not drawing that
 * canvas, and on a busy board it is the largest field on the row.
 */
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

/**
 * Objects for a map-shaped read: id, name, subtitle. No `attributes`, no
 * `methods`, no `template` — the three JSONB columns that carry essentially all
 * of an ontology's bytes and none of its routing information.
 */
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

/**
 * Just the slugs, for `createCluster`'s uniqueness check.
 *
 * That call site used `listClusters`, which meant every cluster's `layout`
 * crossed the wire so `slugify` could compare strings — the whole board's node
 * positions loaded to name one new cluster.
 */
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

/**
 * One object's outbound edges, filtered in Postgres.
 *
 * The service used to answer this by loading EVERY relationship row in the
 * workspace and scanning for a matching `source_object_id` in JavaScript, on
 * four hot paths (create-with-inheritance, update, claim_anchor, get_anchor).
 * The predicate is indexed; there was never a reason for those rows to leave
 * the database.
 */
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

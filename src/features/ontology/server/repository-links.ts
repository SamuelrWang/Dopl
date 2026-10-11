import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Clipped } from "@/shared/supabase/max-rows";
import { emptyWalk, walkedRead } from "./repository-paging";
import {
  ONTOLOGY_MEMBERSHIP_COLS,
  ONTOLOGY_READ_LIMITS,
  ONTOLOGY_RELATIONSHIP_COLS,
  type OntologyMembershipRow,
  type OntologyRelationshipRow,
} from "./dto";

/**
 * THE GRAPH'S LINKS — memberships (object ↔ ontology / parent) and
 * relationships (object → object). Split out of `repository.ts` (cleanup O03,
 * a pure move) so that file stays under the §1 cap. ⚠ `repository.ts`
 * RE-EXPORTS every function here, and every caller imports them from
 * `./repository`: that keeps each `vi.mock("./repository", …)` factory covering
 * them. Import from `./repository`, not from this file.
 *
 * The same rules as `repository.ts` hold: service-role client, every method
 * filters `workspace_id`, every list read is a range walk ordered by `id` last.
 */

export async function listMemberships(
  workspaceIds: readonly string[]
): Promise<Clipped<OntologyMembershipRow>> {
  if (workspaceIds.length === 0) return emptyWalk();
  const db = supabaseAdmin();
  // ⚠ The read this bug hurt most: clip the membership set and
  // `walkAdmittedOntologies` never reaches the subtree below row 1,000, so whole
  // columns vanish off the board.
  return walkedRead<OntologyMembershipRow>(
    (from, to) =>
      db
        .from("ontology_memberships")
        .select(ONTOLOGY_MEMBERSHIP_COLS)
        .in("workspace_id", workspaceIds)
        .order("position")
        .order("created_at")
        .order("id")
        .range(from, to),
    ONTOLOGY_READ_LIMITS.memberships
  );
}

export async function insertMembership(input: {
  workspaceId: string;
  ontologyId: string | null;
  parentObjectId: string | null;
  childObjectId: string;
  position: number;
}): Promise<OntologyMembershipRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_memberships")
    .insert({
      workspace_id: input.workspaceId,
      ontology_id: input.ontologyId,
      parent_object_id: input.parentObjectId,
      child_object_id: input.childObjectId,
      position: input.position,
    })
    .select(ONTOLOGY_MEMBERSHIP_COLS)
    .single();
  if (error) throw error;
  return data as OntologyMembershipRow;
}

export async function countMembershipSiblings(
  workspaceId: string,
  parent: { ontologyId: string } | { parentObjectId: string }
): Promise<number> {
  const db = supabaseAdmin();
  let query = db
    .from("ontology_memberships")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  query =
    "ontologyId" in parent
      ? query.eq("ontology_id", parent.ontologyId)
      : query.eq("parent_object_id", parent.parentObjectId);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Outbound edges of the WALKED object set, sourced by id for the reason
 *  {@link listObjectsByIds} is: an edge from an object no admitted ontology
 *  reaches is not this reader's edge. Targets outside the set are dropped
 *  during assembly. */
export async function listRelationshipsForSources(
  workspaceIds: readonly string[],
  sourceObjectIds: readonly string[]
): Promise<Clipped<OntologyRelationshipRow>> {
  if (workspaceIds.length === 0 || sourceObjectIds.length === 0) return emptyWalk();
  const db = supabaseAdmin();
  return walkedRead<OntologyRelationshipRow>(
    (from, to) =>
      db
        .from("ontology_relationships")
        .select(ONTOLOGY_RELATIONSHIP_COLS)
        .in("workspace_id", workspaceIds)
        .in("source_object_id", sourceObjectIds)
        .order("position")
        .order("created_at")
        .order("id")
        .range(from, to),
    ONTOLOGY_READ_LIMITS.relationships
  );
}

/** Ids from the input that resolve to live objects in this workspace. */
export async function filterObjectIds(
  workspaceIds: readonly string[],
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0 || workspaceIds.length === 0) return new Set();
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .select("id")
    .in("workspace_id", workspaceIds)
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.id as string));
}

export async function replaceRelationshipsForSource(
  workspaceId: string,
  sourceObjectId: string,
  edges: Array<{ label: string; targetIds: string[] }>
): Promise<void> {
  const db = supabaseAdmin();
  const { error: deleteError } = await db
    .from("ontology_relationships")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("source_object_id", sourceObjectId);
  if (deleteError) throw deleteError;

  const rows = edges.flatMap((edge, edgeIndex) =>
    edge.targetIds.map((targetId, targetIndex) => ({
      workspace_id: workspaceId,
      source_object_id: sourceObjectId,
      label: edge.label,
      target_object_id: targetId,
      position: edgeIndex * 1000 + targetIndex,
    }))
  );
  if (rows.length === 0) return;
  const { error: insertError } = await db.from("ontology_relationships").insert(rows);
  if (insertError) throw insertError;
}

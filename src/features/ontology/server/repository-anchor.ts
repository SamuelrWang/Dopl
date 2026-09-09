import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { ONTOLOGY_OBJECT_COLS, type OntologyObjectRow } from "./dto";

/**
 * IDENTITY ANCHOR I/O — the `ontology_objects.user_id` link, and the ONE part
 * of this feature that is about a PERSON rather than about the graph.
 *
 * ⚠ **SPLIT OUT OF `repository.ts` ON 2026-09-09 AT THE §1 CAP** (it measured
 * 518 of 500 once the enumerating reads took a workspace SET). The seam is not
 * arbitrary: an anchor is workspace-scoped IDENTITY and stays keyed on ONE
 * container, while every read left in that module now takes the audience's
 * container SET. Two different tenancy questions in one file is how the wrong
 * one gets copied.
 *
 * ⚠ **STILL SINGLE-CONTAINER, DELIBERATELY (spec §8 R9).** Whose anchor a peer
 * resolves inside a shared container is UNDECIDED, and widening this read to
 * the audience's set would decide it silently, in the direction of showing one
 * member the other's identity object.
 */

/** Point caller's identity anchor at one object. Max one anchor per user per
 *  workspace → previous link cleared first. */
export async function setAnchor(
  workspaceId: string,
  userId: string,
  objectId: string
): Promise<OntologyObjectRow | null> {
  const db = supabaseAdmin();
  const { error: clearError } = await db
    .from("ontology_objects")
    .update({ user_id: null })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .neq("id", objectId);
  if (clearError) throw clearError;

  const { data, error } = await db
    .from("ontology_objects")
    .update({ user_id: userId })
    .eq("workspace_id", workspaceId)
    .eq("id", objectId)
    .is("deleted_at", null)
    .select(ONTOLOGY_OBJECT_COLS)
    .maybeSingle();
  if (error) throw error;
  return data as OntologyObjectRow | null;
}

export async function findAnchorObject(
  workspaceId: string,
  userId: string
): Promise<OntologyObjectRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .select(ONTOLOGY_OBJECT_COLS)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as OntologyObjectRow | null;
}

import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ObjectTypeId, OntologyObject } from "../types";
import {
  ONTOLOGY_CLUSTER_COLS,
  ONTOLOGY_MEMBERSHIP_COLS,
  ONTOLOGY_OBJECT_COLS,
  ONTOLOGY_RELATIONSHIP_COLS,
  type OntologyClusterRow,
  type OntologyMembershipRow,
  type OntologyObjectRow,
  type OntologyRelationshipRow,
} from "./dto";

/**
 * Raw Supabase I/O for the ontology feature. No business logic, no
 * auth checks — that lives in service.ts. Service-role client bypasses
 * RLS; every method filters by workspace_id explicitly so the bypass
 * is contained.
 */

export async function listClusters(workspaceId: string): Promise<OntologyClusterRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_clusters")
    .select(ONTOLOGY_CLUSTER_COLS)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("position")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as OntologyClusterRow[];
}

export async function findClusterById(
  workspaceId: string,
  id: string
): Promise<OntologyClusterRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_clusters")
    .select(ONTOLOGY_CLUSTER_COLS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as OntologyClusterRow | null;
}

export async function findClusterBySlug(
  workspaceId: string,
  slug: string
): Promise<OntologyClusterRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_clusters")
    .select(ONTOLOGY_CLUSTER_COLS)
    .eq("workspace_id", workspaceId)
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as OntologyClusterRow | null;
}

export async function insertCluster(input: {
  workspaceId: string;
  slug: string;
  name: string;
  purpose: string;
  position: number;
  createdBy: string;
}): Promise<OntologyClusterRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_clusters")
    .insert({
      workspace_id: input.workspaceId,
      slug: input.slug,
      name: input.name,
      purpose: input.purpose,
      position: input.position,
      created_by: input.createdBy,
    })
    .select(ONTOLOGY_CLUSTER_COLS)
    .single();
  if (error) throw error;
  return data as OntologyClusterRow;
}

export async function updateCluster(
  workspaceId: string,
  id: string,
  patch: { name?: string; purpose?: string }
): Promise<OntologyClusterRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_clusters")
    .update({ ...(patch.name !== undefined && { name: patch.name }), ...(patch.purpose !== undefined && { purpose: patch.purpose }) })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("deleted_at", null)
    .select(ONTOLOGY_CLUSTER_COLS)
    .maybeSingle();
  if (error) throw error;
  return data as OntologyClusterRow | null;
}

export async function markClusterDeleted(workspaceId: string, id: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("ontology_clusters")
    .update({ deleted_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw error;
}

export async function listObjects(workspaceId: string): Promise<OntologyObjectRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .select(ONTOLOGY_OBJECT_COLS)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as OntologyObjectRow[];
}

export async function findObjectById(
  workspaceId: string,
  id: string
): Promise<OntologyObjectRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .select(ONTOLOGY_OBJECT_COLS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as OntologyObjectRow | null;
}

export async function insertObject(input: {
  workspaceId: string;
  objectType: ObjectTypeId;
  name: string;
  createdBy: string;
}): Promise<OntologyObjectRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .insert({
      workspace_id: input.workspaceId,
      object_type: input.objectType,
      name: input.name,
      created_by: input.createdBy,
    })
    .select(ONTOLOGY_OBJECT_COLS)
    .single();
  if (error) throw error;
  return data as OntologyObjectRow;
}

export async function updateObject(
  workspaceId: string,
  id: string,
  patch: {
    name?: string;
    subtitle?: string;
    objectType?: ObjectTypeId;
    attributes?: OntologyObject["attributes"];
    methods?: OntologyObject["methods"];
  }
): Promise<OntologyObjectRow | null> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.subtitle !== undefined) update.subtitle = patch.subtitle;
  if (patch.objectType !== undefined) update.object_type = patch.objectType;
  if (patch.attributes !== undefined) update.attributes = patch.attributes;
  if (patch.methods !== undefined) update.methods = patch.methods;
  const { data, error } = await db
    .from("ontology_objects")
    .update(update)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("deleted_at", null)
    .select(ONTOLOGY_OBJECT_COLS)
    .maybeSingle();
  if (error) throw error;
  return data as OntologyObjectRow | null;
}

export async function markObjectDeleted(workspaceId: string, id: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("ontology_objects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw error;
}

export async function listMemberships(workspaceId: string): Promise<OntologyMembershipRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_memberships")
    .select(ONTOLOGY_MEMBERSHIP_COLS)
    .eq("workspace_id", workspaceId)
    .order("position")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as OntologyMembershipRow[];
}

export async function insertMembership(input: {
  workspaceId: string;
  clusterId: string | null;
  parentObjectId: string | null;
  childObjectId: string;
  position: number;
}): Promise<OntologyMembershipRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_memberships")
    .insert({
      workspace_id: input.workspaceId,
      cluster_id: input.clusterId,
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
  parent: { clusterId: string } | { parentObjectId: string }
): Promise<number> {
  const db = supabaseAdmin();
  let query = db
    .from("ontology_memberships")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  query =
    "clusterId" in parent
      ? query.eq("cluster_id", parent.clusterId)
      : query.eq("parent_object_id", parent.parentObjectId);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function listRelationships(
  workspaceId: string
): Promise<OntologyRelationshipRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_relationships")
    .select(ONTOLOGY_RELATIONSHIP_COLS)
    .eq("workspace_id", workspaceId)
    .order("position")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as OntologyRelationshipRow[];
}

/** Ids from the input that resolve to live objects in this workspace. */
export async function filterObjectIds(
  workspaceId: string,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .select("id")
    .eq("workspace_id", workspaceId)
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

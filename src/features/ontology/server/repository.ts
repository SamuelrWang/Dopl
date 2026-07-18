import "server-only";
import { mergeStoredLayout, type GraphLayout } from "@/shared/graph";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { OntologyObject } from "../types";
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

/**
 * Strip NUL (U+0000) from every string in a value, recursing through
 * arrays/objects. Postgres `text` and `jsonb` both reject a NUL byte, so an
 * unsanitized name/subtitle or a null byte buried in an attribute/method
 * value would 500 the write. NUL is never meaningful in ontology text, so
 * dropping it at the DB write boundary is safe and covers every caller
 * (MCP agent + web UI). (F-7 ontology portion.)
 */
function stripNullBytes<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/\u0000/g, "") as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripNullBytes(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripNullBytes(v);
    return out as T;
  }
  return value;
}

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
    .insert(
      stripNullBytes({
        workspace_id: input.workspaceId,
        slug: input.slug,
        name: input.name,
        purpose: input.purpose,
        position: input.position,
        created_by: input.createdBy,
      })
    )
    .select(ONTOLOGY_CLUSTER_COLS)
    .single();
  if (error) throw error;
  return data as OntologyClusterRow;
}

/**
 * Resolve the layout to write for a cluster via the shared merge-except-empty
 * semantic (see `mergeStoredLayout`). Reads the current row first for the
 * merge case — the layout column is a single blob, so a partial write must
 * fold in the untouched nodes itself; the reset (`{}`) case skips the read.
 */
async function mergeClusterLayout(
  db: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  id: string,
  patch: GraphLayout
): Promise<GraphLayout> {
  if (Object.keys(patch).length === 0) return {};
  const { data } = await db
    .from("ontology_clusters")
    .select("layout")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  return mergeStoredLayout((data?.layout ?? null) as GraphLayout | null, patch);
}

export async function updateCluster(
  workspaceId: string,
  id: string,
  patch: { name?: string; purpose?: string; layout?: GraphLayout }
): Promise<OntologyClusterRow | null> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = stripNullBytes(patch.name);
  if (patch.purpose !== undefined) update.purpose = stripNullBytes(patch.purpose);
  // Layout merge semantics (shared with workflows service.updateWorkflow):
  // a non-empty layout patch SHALLOW-MERGES per node id into the stored
  // layout, so two tabs each dragging a different card don't clobber each
  // other. An explicit empty `{}` is the reset signal — it REPLACES, wiping
  // every stored position back to pure auto-layout.
  if (patch.layout !== undefined) {
    update.layout = await mergeClusterLayout(db, workspaceId, id, patch.layout);
  }
  const { data, error } = await db
    .from("ontology_clusters")
    .update(update)
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
  name: string;
  createdBy: string;
  attributes?: OntologyObject["attributes"];
  methods?: OntologyObject["methods"];
}): Promise<OntologyObjectRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .insert(
      stripNullBytes({
        workspace_id: input.workspaceId,
        name: input.name,
        created_by: input.createdBy,
        ...(input.attributes?.length ? { attributes: input.attributes } : {}),
        ...(input.methods?.length ? { methods: input.methods } : {}),
      })
    )
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
    attributes?: OntologyObject["attributes"];
    methods?: OntologyObject["methods"];
    template?: OntologyObject["template"];
  },
  expectedUpdatedAt?: string
): Promise<OntologyObjectRow | null> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.subtitle !== undefined) update.subtitle = patch.subtitle;
  if (patch.attributes !== undefined) update.attributes = patch.attributes;
  if (patch.methods !== undefined) update.methods = patch.methods;
  if (patch.template !== undefined) update.template = patch.template;
  let query = db
    .from("ontology_objects")
    .update(stripNullBytes(update))
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("deleted_at", null);
  // Optimistic concurrency: when expectedUpdatedAt is supplied, the
  // `updated_at` filter makes this an atomic compare-and-swap. 0 rows →
  // the row changed (or was deleted) since the caller read it → null,
  // which the service turns into a 412 (stale) or 404 (gone).
  if (expectedUpdatedAt !== undefined) {
    query = query.eq("updated_at", expectedUpdatedAt);
  }
  const { data, error } = await query.select(ONTOLOGY_OBJECT_COLS).maybeSingle();
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

/**
 * Detach a cluster's columns by removing only the membership rows that
 * link objects directly to the cluster (cluster_id = clusterId). The
 * column objects and their nested cards (linked via parent_object_id
 * memberships) are left intact — they survive as detached objects,
 * readable via resolve/get though absent from the cluster map. (F-13.)
 */
export async function deleteMembershipsForCluster(
  workspaceId: string,
  clusterId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("ontology_memberships")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("cluster_id", clusterId);
  if (error) throw error;
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

/**
 * Point the caller's identity anchor at one object — a user has at most
 * one anchor per workspace, so any previous link is cleared first.
 */
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

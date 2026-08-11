import "server-only";
import { mergeStoredLayout, type GraphLayout } from "@/shared/graph";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { OntologyObject } from "../types";
import {
  ONTOLOGY_CLUSTER_COLS,
  ONTOLOGY_MEMBERSHIP_COLS,
  ONTOLOGY_OBJECT_COLS,
  ONTOLOGY_READ_LIMITS,
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
export function stripNullBytes<T>(value: T): T {
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
    .order("created_at")
    .limit(ONTOLOGY_READ_LIMITS.clusters);
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
  // Layout merge semantics:
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

/**
 * Cascade HARD-delete a cluster and every object it owns (its columns plus
 * all nested descendants) in ONE atomic RPC. Deletion is permanent and
 * immediate — there is no trash (2026-08-07). One transaction, so a partial
 * failure can never delete the objects while leaving the cluster behind
 * (the failure mode `cascade_soft_delete_cluster` was written to close).
 * Memberships and relationships cascade via FK.
 *
 * Returns the number of objects deleted, or null when no LIVE cluster matched
 * the id (the service turns that into a 404).
 */
export async function cascadeHardDeleteCluster(
  workspaceId: string,
  clusterId: string
): Promise<number | null> {
  const db = supabaseAdmin();
  // RPC added by migration 20260807120000_ontology_cluster_hard_delete_rpc.sql;
  // not yet in the generated Database types (regenerated after the migration
  // applies). THAT MIGRATION IS DEPLOY-BLOCKING: this is the only code path
  // `deleteCluster` has, so shipping the app without it makes every cluster
  // delete fail at runtime with "function does not exist". The `as never`
  // casts are the house convention for a not-yet-generated RPC (see
  // `chats/server/repository.ts` → `chat_create_with_messages`); they are also
  // the reason the missing function does not fail the build, so the migration
  // has to be tracked by a human, not by tsc.
  const { data, error } = await db.rpc(
    "cascade_hard_delete_cluster" as never,
    {
      p_workspace_id: workspaceId,
      p_cluster_id: clusterId,
    } as never
  );
  if (error) throw error;
  return (data as number | null) ?? null;
}

export async function listObjects(workspaceId: string): Promise<OntologyObjectRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .select(ONTOLOGY_OBJECT_COLS)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .limit(ONTOLOGY_READ_LIMITS.objects);
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

/**
 * PERMANENTLY delete one object AND everything left unreachable by its
 * removal, in ONE atomic RPC. Immediate and irreversible (2026-08-07).
 *
 * A plain single-row DELETE here was a data-integrity bug: the FKs that cascade
 * off an object are on `ontology_memberships`, not on the child objects, so
 * deleting a column or a card removed the LINKS to its subtree and left those
 * objects alive with no parent. Nothing can reach a membership-less object —
 * the board, the graph and the picker all walk down from `cluster.columnIds` —
 * yet `workspace-billing` still counts it against the workspace object cap,
 * forever. Soft-delete never had this problem: the memberships survived and
 * restore re-linked the tree.
 *
 * The RPC deletes the target, then sweeps descendants that the target was the
 * LAST way into; a card that also hangs under another parent survives there.
 * Relationships cascade via FK either way. Its descendant count is discarded
 * here — the delete is the contract — but it is what a "this also deletes N
 * cards" confirm dialog would read.
 */
export async function hardDeleteObject(workspaceId: string, id: string): Promise<void> {
  const db = supabaseAdmin();
  // RPC added by migration 20260807140000_cascade_hard_delete_folder_and_object.sql;
  // not yet in the generated Database types (regenerated after the migration
  // applies). DEPLOY-BLOCKING with that migration — this is `deleteObject`'s
  // only path, so shipping without it fails every object delete at runtime.
  const { error } = await db.rpc(
    "cascade_hard_delete_object" as never,
    { p_workspace_id: workspaceId, p_object_id: id } as never
  );
  if (error) throw error;
}

export async function listMemberships(workspaceId: string): Promise<OntologyMembershipRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_memberships")
    .select(ONTOLOGY_MEMBERSHIP_COLS)
    .eq("workspace_id", workspaceId)
    .order("position")
    .order("created_at")
    .limit(ONTOLOGY_READ_LIMITS.memberships);
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
    .order("created_at")
    .limit(ONTOLOGY_READ_LIMITS.relationships);
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

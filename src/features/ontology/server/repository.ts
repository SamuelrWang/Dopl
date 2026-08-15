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
 * Raw Supabase I/O. Business logic + auth live in service.ts.
 * ⚠ Service-role client bypasses RLS; every method MUST filter workspace_id.
 */

/**
 * Strip NUL (U+0000) from strings, recursing arrays/objects. Postgres `text`
 * and `jsonb` both reject NUL → unsanitized value 500s the write. Sits at the
 * DB write boundary so it covers every caller (MCP + web UI).
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
 * Merge-except-empty layout write (see `mergeStoredLayout`). Merge case reads
 * current row first: layout is one blob, so partial write must fold in
 * untouched nodes itself. Reset (`{}`) skips the read.
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
  // Non-empty patch SHALLOW-MERGES per node id (two tabs dragging different
  // cards must not clobber). Empty `{}` = reset signal: REPLACES, wiping every
  // stored position back to auto-layout.
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
 * Cascade HARD-delete cluster + every object it owns (columns, nested
 * descendants) in ONE atomic RPC. Permanent, no trash. ⚠ Must stay one
 * transaction: partial failure could delete objects and leave cluster behind.
 * Memberships/relationships cascade via FK.
 *
 * Returns objects deleted, or null when no LIVE cluster matched (service → 404).
 */
export async function cascadeHardDeleteCluster(
  workspaceId: string,
  clusterId: string
): Promise<number | null> {
  const db = supabaseAdmin();
  // ⚠ DEPLOY-BLOCKING migration 20260807120000_ontology_cluster_hard_delete_rpc.sql.
  // Sole path for `deleteCluster`; missing → every cluster delete fails at
  // runtime. `as never` = house convention for a not-yet-generated RPC (see
  // `chats/server/repository.ts` → `chat_create_with_messages`) and why tsc
  // can't catch it — track by hand.
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
  // Optimistic concurrency: `updated_at` filter = atomic compare-and-swap.
  // 0 rows → changed-or-deleted since caller read → null → service 412 or 404.
  if (expectedUpdatedAt !== undefined) {
    query = query.eq("updated_at", expectedUpdatedAt);
  }
  const { data, error } = await query.select(ONTOLOGY_OBJECT_COLS).maybeSingle();
  if (error) throw error;
  return data as OntologyObjectRow | null;
}

/**
 * PERMANENTLY delete one object AND everything left unreachable by its removal,
 * in ONE atomic RPC. Irreversible.
 *
 * ⚠ Do NOT reduce to a plain single-row DELETE. Object FKs cascade off
 * `ontology_memberships`, not off child objects — a plain delete drops the
 * LINKS and leaves the subtree alive, unreachable (board/picker walk down from
 * `cluster.columnIds`) yet still counted against the object cap, forever.
 *
 * RPC sweeps descendants it was the LAST way into; a card also hanging under
 * another parent survives. Relationships cascade via FK.
 */
export async function hardDeleteObject(workspaceId: string, id: string): Promise<void> {
  const db = supabaseAdmin();
  // ⚠ DEPLOY-BLOCKING migration
  // 20260807140000_cascade_hard_delete_folder_and_object.sql. Sole path for
  // `deleteObject`; missing → every object delete fails at runtime.
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

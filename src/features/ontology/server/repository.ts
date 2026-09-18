import "server-only";
import { mergeStoredLayout, type GraphLayout } from "@/shared/graph";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { OntologyObject, OntologyWriteSource } from "../types";
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
 * Service-role client bypasses RLS; every method MUST filter workspace_id.
 *
 * The enumerating reads take a workspace SET, not an id: a shared ontology is
 * a reference, never a copy, so the row stays in the LENDER's container while
 * the reader stands in the channel's. The set
 * is `service-audience.ts › OntologyAudience.workspaceIds`, and it is a READ
 * SCOPE — never an authorization; clusters stay filtered by `levelForCluster`,
 * and object reads take ids from the membership walk over ALREADY-ADMITTED
 * clusters (Q8). Same shape, same reason, as
 * `shared/tenancy/personal-container.ts › resolveShelfScope`.
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

export async function listClusters(
  workspaceIds: readonly string[]
): Promise<OntologyClusterRow[]> {
  if (workspaceIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_clusters")
    .select(ONTOLOGY_CLUSTER_COLS)
    .in("workspace_id", workspaceIds)
    .is("deleted_at", null)
    .order("position")
    .order("created_at")
    .limit(ONTOLOGY_READ_LIMITS.clusters);
  if (error) throw error;
  return (data ?? []) as OntologyClusterRow[];
}

export async function findClusterById(
  workspaceIds: readonly string[],
  id: string
): Promise<OntologyClusterRow | null> {
  if (workspaceIds.length === 0) return null;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_clusters")
    .select(ONTOLOGY_CLUSTER_COLS)
    .in("workspace_id", workspaceIds)
    .eq("id", id)
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
  /** Q6 attribution, on the cluster as well as the object — the columns
   *  `20261001120000` adds to BOTH tables. */
  source: OntologyWriteSource;
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
        last_edited_by: input.createdBy,
        last_edited_source: input.source,
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
  patch: {
    name?: string;
    purpose?: string;
    layout?: GraphLayout;
    /** Samuel's solo toggle. Only ever narrows; the service refuses it from
     *  an agent (a containment control cannot be self-widened). */
    agentsMayEdit?: boolean;
  },
  editor: { userId: string; source: OntologyWriteSource }
): Promise<OntologyClusterRow | null> {
  const db = supabaseAdmin();
  // Q3/Q6 — stamped beside the fields, never in a second statement that an
  // edit can reorder past the write it describes.
  const update: Record<string, unknown> = {
    last_edited_by: editor.userId,
    last_edited_source: editor.source,
  };
  if (patch.name !== undefined) update.name = stripNullBytes(patch.name);
  if (patch.purpose !== undefined) update.purpose = stripNullBytes(patch.purpose);
  if (patch.agentsMayEdit !== undefined) update.agents_may_edit = patch.agentsMayEdit;
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
 * Cascade HARD-delete cluster + every object it owns in ONE atomic RPC.
 * Permanent, no trash. Must stay one transaction: partial failure could
 * delete objects and leave the cluster behind. Memberships/relationships
 * cascade via FK. Returns objects deleted, or null when no LIVE cluster
 * matched (service → 404).
 * Returns objects deleted, or null when no LIVE cluster matched (service → 404).
 */
export async function cascadeHardDeleteCluster(
  workspaceId: string,
  clusterId: string
): Promise<number | null> {
  const db = supabaseAdmin();
  // DEPLOY-BLOCKING migration 20260807120000_ontology_cluster_hard_delete_rpc.sql.
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

/**
 * The objects of the ADMITTED clusters, addressed by the ids the membership
 * walk produced. By id, not by container (R1): a whole-container read leaves
 * the narrowing to whatever assembles the graph afterwards, which is a fence
 * only until a second consumer of the rows appears. The walk is the boundary
 * (Q8), so the walk is what the query takes.
 */
export async function listObjectsByIds(
  workspaceIds: readonly string[],
  ids: readonly string[]
): Promise<OntologyObjectRow[]> {
  if (workspaceIds.length === 0 || ids.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .select(ONTOLOGY_OBJECT_COLS)
    .in("workspace_id", workspaceIds)
    .in("id", ids)
    .is("deleted_at", null)
    .limit(ONTOLOGY_READ_LIMITS.objects);
  if (error) throw error;
  return (data ?? []) as OntologyObjectRow[];
}

export async function findObjectById(
  workspaceIds: readonly string[],
  id: string
): Promise<OntologyObjectRow | null> {
  if (workspaceIds.length === 0) return null;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_objects")
    .select(ONTOLOGY_OBJECT_COLS)
    .in("workspace_id", workspaceIds)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data as OntologyObjectRow | null;
}

/** The attribution stamp is not optional (Q3/Q6): an edit made through a
 *  share survives the unshare, attributed to its author and to whether a
 *  person or an agent made it. Every write path below stamps it. */
export async function insertObject(input: {
  workspaceId: string;
  name: string;
  createdBy: string;
  source: OntologyWriteSource;
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
        last_edited_by: input.createdBy,
        last_edited_source: input.source,
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
  editor: { userId: string; source: OntologyWriteSource },
  expectedUpdatedAt?: string
): Promise<OntologyObjectRow | null> {
  const db = supabaseAdmin();
  // Q3/Q6 — stamped on every field patch, beside the fields themselves, so the
  // attribution cannot be reordered past the write it describes.
  const update: Record<string, unknown> = {
    last_edited_by: editor.userId,
    last_edited_source: editor.source,
  };
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
 * PERMANENTLY delete one object AND everything left unreachable by its
 * removal, in ONE atomic RPC. Irreversible.
 *
 * Do NOT reduce to a plain single-row DELETE: object FKs cascade off
 * `ontology_memberships`, not off child objects, so a plain delete drops the
 * LINKS and leaves the subtree alive, unreachable yet still counted against
 * the object cap. The RPC sweeps descendants it was the LAST way into; a card
 * also hanging under another parent survives. Relationships cascade via FK.
 */
export async function hardDeleteObject(workspaceId: string, id: string): Promise<void> {
  const db = supabaseAdmin();
  // DEPLOY-BLOCKING migration
  // 20260807140000_cascade_hard_delete_folder_and_object.sql. Sole path for
  // `deleteObject`; missing → every object delete fails at runtime.
  const { error } = await db.rpc(
    "cascade_hard_delete_object" as never,
    { p_workspace_id: workspaceId, p_object_id: id } as never
  );
  if (error) throw error;
}

export async function listMemberships(
  workspaceIds: readonly string[]
): Promise<OntologyMembershipRow[]> {
  if (workspaceIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_memberships")
    .select(ONTOLOGY_MEMBERSHIP_COLS)
    .in("workspace_id", workspaceIds)
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

/** Outbound edges of the WALKED object set, sourced by id for the reason
 *  {@link listObjectsByIds} is: an edge from an object no admitted cluster
 *  reaches is not this reader's edge. Targets outside the set are dropped
 *  during assembly. */
export async function listRelationshipsForSources(
  workspaceIds: readonly string[],
  sourceObjectIds: readonly string[]
): Promise<OntologyRelationshipRow[]> {
  if (workspaceIds.length === 0 || sourceObjectIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("ontology_relationships")
    .select(ONTOLOGY_RELATIONSHIP_COLS)
    .in("workspace_id", workspaceIds)
    .in("source_object_id", sourceObjectIds)
    .order("position")
    .order("created_at")
    .limit(ONTOLOGY_READ_LIMITS.relationships);
  if (error) throw error;
  return (data ?? []) as OntologyRelationshipRow[];
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

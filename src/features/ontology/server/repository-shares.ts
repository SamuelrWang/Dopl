import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Role } from "@/features/workspaces/types";
import type { OntologyLevel } from "../types";

/**
 * Raw Supabase I/O for the HOME-ONTOLOGY SHARING MODEL — the `(ontology,
 * channel)` rows of `ontology_channel_shares` and the four container facts the
 * audience ceiling is built from (`service-audience.ts`). No business logic.
 *
 * Every input to the ceiling is a DB fact read here, on the service client
 * (`knowledge/server/repository-audience.ts`'s design, verbatim): it may not be
 * decided by anything the caller can type. `X-Workspace-Id`, `X-Dopl-Runtime` and
 * `X-Dopl-Session-Id` are documented NON-authorization signals (INVARIANTS §10)
 * and any device token can send any value for all three.
 *
 * Creates its own client, matching `./repository.ts` and
 * `./repository-projections.ts`. INVARIANTS §2 states the opposite rule ("takes a
 * `SupabaseClient`, never creates one"); the disagreement PREDATES this file and
 * is reported rather than resolved either way (CLAUDE.md's precedence rule).
 *
 * Service role BYPASSES RLS, so the SERVICE is the fence on every read here
 * and the `dopl_ontology_readable` twin (S1) is not a backstop for it.
 */

export const ONTOLOGY_SHARE_COLS =
  "ontology_id, channel_id, workspace_id, members_level, guests_level, owner_agents_level";

export interface OntologyShareRow {
  ontology_id: string;
  /** The channel the ontology is lent INTO. */
  channel_id: string;
  /** The ONTOLOGY's container, never the channel's (spec §3.1, rule 3 of
   *  `20260914120000`) — it is what makes the cross-container lend addressable
   *  and what the audience widens its read set with. */
  workspace_id: string;
  members_level: OntologyLevel;
  guests_level: OntologyLevel;
  owner_agents_level: OntologyLevel;
}

/** Ceiling on the container's channel fan and the share rows read through it.
 * `knowledge › CONTAINER_CHANNEL_LIMIT`'s reason: PostgREST truncates an
 *  un-limited select SILENTLY, which narrows the admitted set invisibly — safe,
 *  and undebuggable. */
export const ONTOLOGY_SHARE_LIMIT = 500;

/** `workspaces.kind` for one workspace, or `null` when the row is gone.
 *  Raw COLUMN, not a predicate — the ceiling asks "is this specifically a
 *  link/personal container", which must answer NO for a kind nobody has
 *  designed yet. */
export async function findWorkspaceKind(workspaceId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspaces")
    .select("kind")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as { kind: string | null } | null)?.kind ?? null;
}

/**
 * How many ACTIVE members the container has — the SOLO/SHARED question behind
 * Samuel's solo default (*"viewable and editable by their agents"*).
 *
 * `status='active'`, as every other member count: an invited-but-unaccepted
 * row is not a peer in the room. A `null` count is reported as `null`, not
 * `0` — `./service-audience.ts` decides what silence means (it fails CLOSED).
 */
export async function countActiveWorkspaceMembers(
  workspaceId: string
): Promise<number | null> {
  const { count, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  if (error) throw error;
  return count ?? null;
}

/** Every live channel id in the container — the SET the ceiling reads shares
 *  against. NOT narrowed by channel membership: a link container holds ONE
 *  channel whose members are the container's (INVARIANTS §4A), and the share row
 *  is the authorization either way. */
export async function listChannelIdsForWorkspace(workspaceId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .limit(ONTOLOGY_SHARE_LIMIT);
  if (error) throw error;
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * Every share row landing on ANY of `channelIds` — the reachable set behind
 * `resolveOntologyAudience`.
 *
 * NO `workspace_id` TERM — F-662 applied to this table. The row is filed
 * under the ONTOLOGY's container while the caller reaches it through the
 * CHANNEL's, so an `.eq("workspace_id", …)` would refuse precisely the
 * cross-container lend. `channelIds` IS the fence, computed from the caller's own
 * container one call up.
 *
 * Empty `channelIds` short-circuits with NO QUERY — fail-closed, and a `.in()`
 * on an empty array is a syntax hazard.
 */
export async function listSharesForChannels(
  channelIds: string[]
): Promise<OntologyShareRow[]> {
  if (channelIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("ontology_channel_shares")
    .select(ONTOLOGY_SHARE_COLS)
    .in("channel_id", channelIds)
    .limit(ONTOLOGY_SHARE_LIMIT);
  if (error) throw error;
  return (data ?? []) as OntologyShareRow[];
}

/**
 * How many channels each of these ontologies is lent into — the card's
 * "shared into N channels" line, for a WHOLE list.
 *
 * One query for the row set, never one per row — a `count` per cluster would
 * be an N+1 on the hottest read this feature has.
 *
 * Every requested id gets an entry, including `0`: `0` is a MEASUREMENT
 * ("lent into no channel") while an absent key upstream means "nobody looked"
 * (`../types.ts › OntologyCluster.sharedChannelCount` keeps them apart).
 *
 * Two ids only, no `ONTOLOGY_SHARE_COLS`: nothing here reads a level.
 */
export async function countSharesForClusters(
  clusterIds: readonly string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(clusterIds.map((id) => [id, 0]));
  if (clusterIds.length === 0) return counts;
  const { data, error } = await supabaseAdmin()
    .from("ontology_channel_shares")
    .select("ontology_id, channel_id")
    .in("ontology_id", clusterIds)
    .limit(ONTOLOGY_SHARE_LIMIT);
  if (error) throw error;
  for (const row of (data ?? []) as { ontology_id: string }[]) {
    counts.set(row.ontology_id, (counts.get(row.ontology_id) ?? 0) + 1);
  }
  return counts;
}

/** Every channel one ontology is shared into — the inverse read, behind the
 *  share dialog's GET and the delete-confirm's channel COUNT (Q4). */
export async function listSharesForCluster(
  clusterId: string
): Promise<OntologyShareRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("ontology_channel_shares")
    .select(ONTOLOGY_SHARE_COLS)
    .eq("ontology_id", clusterId)
    .limit(ONTOLOGY_SHARE_LIMIT);
  if (error) throw error;
  return (data ?? []) as OntologyShareRow[];
}

export interface OntologyShareWrite {
  ontologyId: string;
  channelId: string;
  /** The ONTOLOGY's container. The service reads it off the cluster row it
   *  has already fenced; taking it from the request would let a caller file a
   *  lend under somebody else's tenancy. */
  workspaceId: string;
  membersLevel: OntologyLevel;
  guestsLevel: OntologyLevel;
  ownerAgentsLevel: OntologyLevel;
  createdBy: string;
}

/** Upsert one `(ontology, channel)` row — the desired END STATE for all three
 *  audiences, so a retry after an ambiguous failure is idempotent (the
 *  `channel-grants` PUT contract, with three levels). */
export async function upsertShare(
  input: OntologyShareWrite
): Promise<OntologyShareRow> {
  const { data, error } = await supabaseAdmin()
    .from("ontology_channel_shares")
    .upsert(
      {
        ontology_id: input.ontologyId,
        channel_id: input.channelId,
        workspace_id: input.workspaceId,
        members_level: input.membersLevel,
        guests_level: input.guestsLevel,
        owner_agents_level: input.ownerAgentsLevel,
        created_by: input.createdBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ontology_id,channel_id" }
    )
    .select(ONTOLOGY_SHARE_COLS)
    .single();
  if (error) throw error;
  return data as OntologyShareRow;
}

/** UNSHARE — a row DELETE, never a stored triple of `none` (I4). */
export async function deleteShare(
  clusterId: string,
  channelId: string
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("ontology_channel_shares")
    .delete()
    .eq("ontology_id", clusterId)
    .eq("channel_id", channelId);
  if (error) throw error;
}

/** A live channel's own container, or `null`. Resolution is not
 *  authorization: the caller still has to prove a membership of the container
 *  this names ({@link findActiveMemberRole}). */
export async function findChannelContainer(
  channelId: string
): Promise<{ channelId: string; workspaceId: string } | null> {
  const { data, error } = await supabaseAdmin()
    .from("channels")
    .select("id, workspace_id")
    .eq("id", channelId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  const row = data as { id: string; workspace_id: string } | null;
  return row ? { channelId: row.id, workspaceId: row.workspace_id } : null;
}

/** The caller's ACTIVE role in one workspace, or `null` — the membership fence
 *  the share lane applies to the CHANNEL's container, which is not the
 *  container `withWorkspaceAuth` proved. */
export async function findActiveMemberRole(
  workspaceId: string,
  userId: string
): Promise<Role | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return (data as { role: Role } | null)?.role ?? null;
}

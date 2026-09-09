import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Revision, RevisionOp, RevisionResourceType } from "../types";
import { REVISION_COLS, mapRevisionRow, type RevisionRow } from "./dto";

/**
 * Raw Supabase I/O for `revisions`. No business logic, no auth checks, no error
 * translation; those live in `./service.ts`.
 *
 * 🔒 ⚠ **THE APPEND IS AWAITED AND ITS FAILURE THROWS — NEVER FIRE-AND-FORGET.**
 * This is the opposite of `analytics/server/mcp-tool-calls.ts › logMcpToolCall`,
 * which is `void`-ed on purpose, and the difference is what is lost: that one
 * loses a usage tally, this one loses the record that a document changed. A LOST
 * REVISION IS A LOST AUDIT, so the caller wears the error and the write it was
 * recording is reported as failed. Mutation-verified in `./service.test.ts`.
 *
 * 🔒 ⚠ **THIS CLIENT IS THE SERVICE ROLE AND BYPASSES RLS** (INVARIANTS §2), so
 * `revisions_member_select` evaluates for nobody on this path. Every read here
 * takes an id set or a `workspace_id` that a FENCED read has already produced —
 * the id set IS the fence, exactly as `repository-pins.ts` requires. Nothing in
 * this module knows what a knowledge base is, let alone who may see one.
 */

export interface AppendRevisionArgs {
  resourceType: RevisionResourceType;
  resourceId: string;
  workspaceId: string;
  actorUserId: string | null;
  actorKind: "user" | "agent";
  agentSessionId: string | null;
  op: RevisionOp;
  summary: string | null;
  payload: Record<string, unknown>;
  contentHash: string;
}

/** INSERT one row and answer it. Throws on any error — see the module docblock. */
export async function appendRevision(
  args: AppendRevisionArgs
): Promise<Revision> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("revisions")
    .insert({
      resource_type: args.resourceType,
      resource_id: args.resourceId,
      workspace_id: args.workspaceId,
      actor_user_id: args.actorUserId,
      actor_kind: args.actorKind,
      agent_session_id: args.agentSessionId,
      op: args.op,
      summary: args.summary,
      payload: args.payload,
      content_hash: args.contentHash,
    })
    .select(REVISION_COLS)
    .single();
  if (error) throw error;
  return mapRevisionRow(data as RevisionRow);
}

/**
 * REPLACE an open row's snapshot — the human coalescing window's only write.
 * ⚠ `created_at` IS NOT TOUCHED: the row keeps the moment the person started.
 * The service decides whether a row is open; this only performs the swap.
 */
export async function replaceRevisionSnapshot(
  id: string,
  patch: { payload: Record<string, unknown>; contentHash: string; summary: string | null },
  now: string
): Promise<Revision> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("revisions")
    .update({
      payload: patch.payload,
      content_hash: patch.contentHash,
      summary: patch.summary,
      updated_at: now,
    })
    .eq("id", id)
    .select(REVISION_COLS)
    .single();
  if (error) throw error;
  return mapRevisionRow(data as RevisionRow);
}

/**
 * The NEWEST revision for one resource, or `null`. The coalescing window's read:
 * whether the last row is still open is the SERVICE's arithmetic, not a
 * predicate baked into this query, so the same row answers both "is it open"
 * and "what did the previous state look like".
 */
export async function findLatestRevision(
  resourceType: RevisionResourceType,
  resourceId: string
): Promise<Revision | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("revisions")
    .select(REVISION_COLS)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRevisionRow(data as RevisionRow) : null;
}

export async function findRevisionById(id: string): Promise<Revision | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("revisions")
    .select(REVISION_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRevisionRow(data as RevisionRow) : null;
}

export interface RevisionCursor {
  createdAt: string;
  id: string;
}

export interface RevisionPageQuery {
  /**
   * Keyset: rows STRICTLY OLDER than this `(created_at, id)` pair. ⚠ NOT AN
   * OFFSET — an append between pages shifts an offset and silently drops a row.
   * ⚠ AND NOT `created_at` ALONE: two rows written in the same millisecond
   * would straddle the boundary and one of them would never be returned, so the
   * id is the tie-break in the filter exactly as it is in the ORDER BY.
   */
  before?: RevisionCursor;
  /** Rows to fetch. The service asks for `limit + 1` to learn whether more
   *  exist; this returns exactly what it is asked for. */
  limit: number;
}

/** The `(created_at, id) < (…)` half of the keyset, as PostgREST spells it. */
function keysetFilter(before: RevisionCursor): string {
  return (
    `created_at.lt.${before.createdAt},` +
    `and(created_at.eq.${before.createdAt},id.lt.${before.id})`
  );
}

/**
 * One resource's history, newest first. Backed by `revisions_resource_idx`.
 *
 * ⚠ `created_at DESC, id DESC` — the id is the TIE-BREAK, and without it two
 * rows written in the same millisecond can swap between pages and one of them is
 * never returned. The cursor carries both halves (`service.ts › encodeCursor`).
 */
export async function listRevisionsForResource(
  resourceType: RevisionResourceType,
  resourceId: string,
  query: RevisionPageQuery
): Promise<Revision[]> {
  const db = supabaseAdmin();
  let q = db
    .from("revisions")
    .select(REVISION_COLS)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId);
  if (query.before) q = q.or(keysetFilter(query.before));
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(query.limit);
  if (error) throw error;
  return (data ?? []).map((row) => mapRevisionRow(row as RevisionRow));
}

/**
 * The ROLL-UP: every revision over a SET of resource ids, newest first — one
 * `IN` query, never a per-row lookup (INVARIANTS §9's bounded fan).
 *
 * 🔒 ⚠ **THE ID SET IS THE FENCE.** Callers pass ids that a fenced read already
 * produced (a base's own entries and folders, resolved through the knowledge
 * service). `workspaceId` narrows to the resource's container and is the second
 * belt, not the first.
 */
export async function listRevisionsForResources(
  workspaceId: string,
  resourceIds: string[],
  query: RevisionPageQuery
): Promise<Revision[]> {
  if (resourceIds.length === 0) return [];
  const db = supabaseAdmin();
  let q = db
    .from("revisions")
    .select(REVISION_COLS)
    .eq("workspace_id", workspaceId)
    .in("resource_id", resourceIds);
  if (query.before) q = q.or(keysetFilter(query.before));
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(query.limit);
  if (error) throw error;
  return (data ?? []).map((row) => mapRevisionRow(row as RevisionRow));
}

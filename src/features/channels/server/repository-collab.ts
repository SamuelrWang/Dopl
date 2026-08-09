import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { PRESENCE_ONLINE_WINDOW_MS } from "../constants";
import type { AgentPresenceStatus } from "../types";
import type {
  ConsentRequestRow,
  PresenceRow,
  TrustRuleRow,
} from "./collab-dto";

/**
 * Explicit row caps. PostgREST applies its own `max-rows` server setting to
 * an un-limited select and truncates SILENTLY (no error, no marker), so any
 * read whose result feeds a derived count states its bound here instead of
 * inheriting an invisible one. Each is far above a realistic workspace and
 * exists to make truncation loud (a clipped list is a wrong online count, not
 * a crash).
 */
const CONSENT_LIST_LIMIT = 200;
const PRESENCE_ROWS_LIMIT = 5_000;
const CHANNEL_MEMBER_ROWS_LIMIT = 10_000;

/**
 * Pure data access for the v1.2 collaboration tables (consent requests,
 * trust rules, presence) plus the presence read-helpers the channels reads
 * hydrate members / online counts with. Kept out of `repository.ts` so that
 * file stays under the 500-line cap. Every function uses the service-role
 * admin client (RLS-bypassing) — visibility + authz live in the services.
 */

// ─── Consent requests ───────────────────────────────────────────────

type ConsentInsert = {
  channel_id: string;
  workspace_id: string;
  operator_user_id: string;
  requester_user_id: string | null;
  kind: string;
  message_seq: number | null;
  summary: string;
  body_preview: string;
  proposed_reply: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  expires_at: string | null;
};

export async function insertConsentRequest(
  row: ConsentInsert
): Promise<ConsentRequestRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_consent_requests")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as ConsentRequestRow;
}

/**
 * Lazy expiry sweep, scoped to one operator: flip their elapsed pending rows
 * to 'expired' before a read so the inbox never shows a stale prompt. Cheap —
 * the (operator_user_id, status) index makes it a no-op when nothing elapsed.
 */
export async function expireStalePending(operatorUserId: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("channel_consent_requests")
    .update({ status: "expired", decided_at: new Date().toISOString() })
    .eq("operator_user_id", operatorUserId)
    .eq("status", "pending")
    .not("expires_at", "is", null)
    .lt("expires_at", new Date().toISOString());
  if (error) throw error;
}

interface ConsentListOpts {
  channelId?: string;
  statuses?: string[];
}

export async function listConsentRequests(
  operatorUserId: string,
  opts: ConsentListOpts = {}
): Promise<ConsentRequestRow[]> {
  const db = supabaseAdmin();
  let query = db
    .from("channel_consent_requests")
    .select("*")
    .eq("operator_user_id", operatorUserId);
  if (opts.channelId) query = query.eq("channel_id", opts.channelId);
  if (opts.statuses && opts.statuses.length > 0) {
    query = query.in("status", opts.statuses);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(CONSENT_LIST_LIMIT);
  if (error) throw error;
  return (data ?? []) as ConsentRequestRow[];
}

export async function findConsentById(
  id: string
): Promise<ConsentRequestRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_consent_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ConsentRequestRow | null) ?? null;
}

/**
 * The row already raised for one trigger, whatever its status. The de-dupe
 * key is (operator, channel, kind, message_seq) — the operator is part of it
 * because every recipient of a message raises their OWN request against the
 * same seq, so a channel-wide key would collide across teammates.
 *
 * This is the indexed replacement for scanning the operator's whole consent
 * history in JS: those rows carry up to 32KB of body_preview + proposed_reply
 * EACH and `auto_allowed` ones are never swept, so a trusted teammate's
 * traffic would grow the scan without bound. A partial unique index backs
 * this key, so `limit(1)` is belt-and-braces for rows predating it.
 */
export async function findConsentByTrigger(
  operatorUserId: string,
  channelId: string,
  kind: string,
  messageSeq: number
): Promise<ConsentRequestRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_consent_requests")
    .select("*")
    .eq("operator_user_id", operatorUserId)
    .eq("channel_id", channelId)
    .eq("kind", kind)
    .eq("message_seq", messageSeq)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ConsentRequestRow | null) ?? null;
}

type ConsentDecisionPatch = {
  status: string;
  decided_by: string;
  decided_at: string;
};

/**
 * Compare-and-swap the decision: the UPDATE only lands while the row is
 * still `pending`, and a no-op returns null so the caller can 409.
 *
 * This surface is explicitly multi-writer — the desktop's native dialog, its
 * alert notification, and the web card all race for the same row, and the
 * desktop additionally mirrors a locally-made decision back with a PATCH. A
 * read-then-write would let a late Allow silently overwrite the human's Deny
 * (the whole point of the gate) and would re-stamp `decided_at` on an already
 * settled request. The `.eq("status","pending")` guard makes first-writer-wins
 * a property of the database, not of the interleaving.
 */
export async function updateConsentDecision(
  id: string,
  patch: ConsentDecisionPatch
): Promise<ConsentRequestRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_consent_requests")
    .update(patch)
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as ConsentRequestRow | null) ?? null;
}

/**
 * Retire ONE `auto_allowed` row whose standing trust rule no longer holds
 * (C-19). Compare-and-swap on `status = 'auto_allowed'` for exactly the reason
 * `updateConsentDecision` CASes on `pending`: this surface is multi-writer, so
 * a revocation sweep must never clobber a status some other writer already
 * moved. A no-op returns null and the caller re-reads rather than trusting its
 * own stale copy.
 *
 * `decided_by` / `decided_at` are LEFT ALONE — "a trust rule allowed this row,
 * at this time" stays true and is the audit trail. `expires_at` is null on an
 * auto-allow (which is *why* the row never elapsed on its own), so stamping it
 * here records the moment the authority died: the row reads "trust allowed it,
 * then the rule was gone before anything consumed it."
 */
export async function expireRevokedAutoAllow(
  id: string
): Promise<ConsentRequestRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_consent_requests")
    .update({ status: "expired", expires_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "auto_allowed")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as ConsentRequestRow | null) ?? null;
}

/** Author of the message at (channel, seq) — inbound requester derivation. */
export async function findMessageAuthorBySeq(
  channelId: string,
  seq: number
): Promise<string | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("author_user_id")
    .eq("channel_id", channelId)
    .eq("seq", seq)
    .maybeSingle();
  if (error) throw error;
  return (data as { author_user_id: string | null } | null)?.author_user_id ?? null;
}

// ─── Trust rules ────────────────────────────────────────────────────

export async function listTrustRules(
  operatorUserId: string,
  workspaceId: string
): Promise<TrustRuleRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_trust_rules")
    .select("*")
    .eq("operator_user_id", operatorUserId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TrustRuleRow[];
}

export async function findTrustRule(
  operatorUserId: string,
  trustedUserId: string,
  workspaceId: string
): Promise<TrustRuleRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_trust_rules")
    .select("*")
    .eq("operator_user_id", operatorUserId)
    .eq("trusted_user_id", trustedUserId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as TrustRuleRow | null) ?? null;
}

export async function insertTrustRule(row: {
  operator_user_id: string;
  trusted_user_id: string;
  workspace_id: string;
}): Promise<TrustRuleRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_trust_rules")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as TrustRuleRow;
}

export async function deleteTrustRule(
  operatorUserId: string,
  trustedUserId: string,
  workspaceId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("agent_trust_rules")
    .delete()
    .eq("operator_user_id", operatorUserId)
    .eq("trusted_user_id", trustedUserId)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}

// ─── Presence ───────────────────────────────────────────────────────

export async function upsertPresence(
  userId: string,
  workspaceId: string,
  status: AgentPresenceStatus
): Promise<PresenceRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_presence")
    .upsert(
      {
        user_id: userId,
        workspace_id: workspaceId,
        last_seen_at: new Date().toISOString(),
        status,
      },
      { onConflict: "user_id,workspace_id" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as PresenceRow;
}

export interface DerivedPresence {
  online: boolean;
  lastSeenAt: string | null;
}

/**
 * Presence for every member of a workspace, keyed by user id, with `online`
 * derived against the 90s window. Drives the roster's online dots + the
 * per-channel online counts. One indexed query for the whole page.
 */
export async function presenceForWorkspace(
  workspaceId: string
): Promise<Map<string, DerivedPresence>> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_presence")
    .select("user_id, last_seen_at")
    .eq("workspace_id", workspaceId)
    .limit(PRESENCE_ROWS_LIMIT);
  if (error) throw error;
  const cutoff = Date.now() - PRESENCE_ONLINE_WINDOW_MS;
  const out = new Map<string, DerivedPresence>();
  for (const row of (data ?? []) as Array<{
    user_id: string;
    last_seen_at: string;
  }>) {
    out.set(row.user_id, {
      online: Date.parse(row.last_seen_at) > cutoff,
      lastSeenAt: row.last_seen_at,
    });
  }
  return out;
}

/** Member user-ids per channel — pairs with presence for online counts. */
export async function channelMemberUserIds(
  channelIds: string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (channelIds.length === 0) return out;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("channel_id, user_id")
    .in("channel_id", channelIds)
    .limit(CHANNEL_MEMBER_ROWS_LIMIT);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    channel_id: string;
    user_id: string;
  }>) {
    const list = out.get(row.channel_id);
    if (list) list.push(row.user_id);
    else out.set(row.channel_id, [row.user_id]);
  }
  return out;
}

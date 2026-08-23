import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { PRESENCE_ONLINE_WINDOW_MS } from "../constants";
import type { AgentPresenceStatus } from "../types";
import type { MemberPresence } from "./dto";
import type { ConsentRequestRow, PresenceRow } from "./collab-dto";

/**
 * ⚠ Explicit row caps. PostgREST applies its own `max-rows` to an un-limited
 * select and truncates SILENTLY — no error, no marker — so any read feeding a
 * derived count states its bound HERE rather than inheriting an invisible one.
 * A clipped list is a wrong online count, not a crash.
 */
const CONSENT_LIST_LIMIT = 200;
const PRESENCE_ROWS_LIMIT = 5_000;
/** ⚠ EXPORTED (2026-08-20) because `repository.ts › memberCounts` reads the same
 *  table for the same fan-in and had no bound at all. It is one ceiling on
 *  purpose: two would be two different answers to "how many members". */
export const CHANNEL_MEMBER_ROWS_LIMIT = 10_000;

/**
 * Pure data access for the collaboration tables (consent requests, presence)
 * plus the presence read-helpers. ⚠ Service-role admin client (RLS-bypassing) —
 * visibility + authz live in the SERVICES.
 *
 * ⚠ IT READ A THIRD TABLE UNTIL 2026-08-22: `agent_trust_rules`, behind
 * `listTrustRules` / `findTrustRule` / `insertTrustRule` / `deleteTrustRule`.
 * The table is DROPPED (`20260822140000_retire_inbound_consent_and_trust.sql`) with the
 * inbound consent lane it existed to auto-allow, so the four readers are gone
 * rather than left pointing at a relation that is not there. Same change took
 * `expireRevokedAutoAllow` below it — see that tombstone for why an
 * `auto_allowed` row can no longer be born.
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
 * Lazy expiry sweep for one operator: flip elapsed pending rows to 'expired'
 * before a read so the inbox never shows a stale prompt. The
 * (operator_user_id, status) index makes it a no-op when nothing elapsed.
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

/**
 * How many `message_seq` values go into one `IN (…)` — PostgREST puts the whole
 * list in the query STRING, and an unbounded thread's transcript would build a
 * URL long enough for a proxy to refuse. Chunked rather than capped: every seq
 * must be asked about, and a refused request is a silently unswept inbox.
 */
const CONSENT_SEQ_CHUNK = 100;

/**
 * EXPIRE — never delete — every PENDING consent row whose trigger message just
 * went away. The consent step of the thread cascade
 * (`service-tasks-delete.ts › deleteTask`).
 *
 * ⚠ EXPIRE, NOT DELETE, AND THAT IS THE WHOLE DECISION. A consent row is the
 * AUDIT of a human decision (`status` / `decided_by` / `decided_at`) — a row that
 * was allowed or denied is a record of what somebody did, and a thread deletion
 * is nobody's licence to erase it. A row still `pending` is the opposite case: its
 * trigger message no longer exists, so the operator can never answer it honestly
 * and the card would sit in the inbox forever pointing at nothing. `expired` is
 * the state the model already has for "this prompt outlived its question" and it
 * is reached here by exactly the statement {@link expireStalePending} uses.
 *
 * ⚠ THE KEY IS `message_seq` AND IT IS CLEAN DESPITE HAVING NO FK. `seq` is a
 * TABLE-wide identity (INVARIANTS §5) so the number is globally unique, and the
 * caller hands over the seqs the delete ACTUALLY removed rather than a guessed
 * range. `channel_id` is still named: it costs nothing, it uses
 * `channel_consent_requests_channel_idx`, and it keeps this statement unable to
 * touch another room even if a caller ever passed the wrong list.
 *
 * ⚠ NOT scoped to one operator, unlike {@link expireStalePending}: every
 * recipient raises their OWN row against the same seq, and all of them are
 * equally stranded.
 *
 * ⚠ OUTBOUND rows are reached too, and correctly: an outbound review carries the
 * `message_seq` of the inbound ask it is a reply to when one exists, and carries
 * `null` otherwise — a `null` never matches an `IN` list, so nothing is swept by
 * accident.
 */
export async function expireConsentForMessageSeqs(
  channelId: string,
  seqs: readonly number[]
): Promise<void> {
  if (seqs.length === 0) return;
  const db = supabaseAdmin();
  for (let i = 0; i < seqs.length; i += CONSENT_SEQ_CHUNK) {
    const chunk = seqs.slice(i, i + CONSENT_SEQ_CHUNK);
    const { error } = await db
      .from("channel_consent_requests")
      .update({ status: "expired", decided_at: new Date().toISOString() })
      .eq("channel_id", channelId)
      .eq("status", "pending")
      .in("message_seq", chunk as number[]);
    if (error) throw error;
  }
}

interface ConsentListOpts {
  /**
   * ⚠ REQUIRED, not optional. A consent row carries `operator_user_id` and
   * nothing else naming WHOSE workspace raised it, so an operator-only filter
   * returns pending rows from EVERY workspace they belong to — and the sidebar's
   * pending badge is built from this list. This read runs under
   * `supabaseAdmin()` (service role), so RLS is no backstop; RLS would scope to
   * the operator anyway, which is not the same bound.
   */
  workspaceId: string;
  channelId?: string;
  statuses?: string[];
}

export async function listConsentRequests(
  operatorUserId: string,
  opts: ConsentListOpts
): Promise<ConsentRequestRow[]> {
  const db = supabaseAdmin();
  let query = db
    .from("channel_consent_requests")
    .select("*")
    .eq("operator_user_id", operatorUserId)
    .eq("workspace_id", opts.workspaceId);
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
 * The row already raised for one trigger, whatever its status. De-dupe key is
 * (operator, channel, kind, message_seq) — ⚠ the operator is part of it because
 * every recipient raises their OWN request against the same seq, so a
 * channel-wide key collides across teammates.
 *
 * ⚠ Indexed, never a JS scan of the operator's consent history: those rows carry
 * up to 32KB of body_preview + proposed_reply EACH and `auto_allowed` ones are
 * never swept, so a trusted teammate's traffic grows the scan without bound.
 * A partial unique index backs the key; `limit(1)` covers rows predating it.
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
 * Compare-and-swap the decision: the UPDATE lands only while the row is still
 * `pending`; a no-op returns null so the caller can 409.
 *
 * ⚠ Explicitly multi-writer — the desktop's native dialog, its alert
 * notification and the web card all race for this row, and the desktop mirrors
 * a local decision back with a PATCH. A read-then-write lets a late Allow
 * overwrite the human's Deny and re-stamps `decided_at` on a settled request.
 * The `.eq("status","pending")` guard makes first-writer-wins a property of the
 * DATABASE, not of the interleaving.
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

// ⚠ `expireRevokedAutoAllow` STOOD HERE AND IS DELETED (2026-08-22). It CAS'd
// one `auto_allowed` row to `expired` when the standing trust rule behind it had
// been revoked. `auto_allowed` had exactly ONE writer — `insertConsentRequest`,
// on an INBOUND create whose requester was trusted — and both halves are gone:
// the inbound kind is retired and `agent_trust_rules` is dropped. So no row of
// that status can be born, and the sweep guards a shape with no producer.
// ⚠ The STATUS VALUE survives in `STATUS_FILTERS.decided` on purpose: it stays
// readable if the column ever holds one, because retiring a writer is not a
// licence to hide history. (Measured before the drop: zero `auto_allowed` rows
// in the table's history — re-measure, never quote.)

// ⚠ `findMessageAuthorBySeq` STOOD HERE AND MOVED to `repository-messages.ts`
// (2026-08-20). It reads `channel_messages`, which that file owns, and it was a
// second (channel, seq) → `maybeSingle()` lookup sitting one file away from its
// twin — the shape a third copy gets added to. It is still the consent path's,
// only its address changed.

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

/**
 * ⚠ `DerivedPresence` STOOD HERE AND IS GONE (2026-08-20) — it was
 * `dto.ts › MemberPresence` declared a second time, field for field, under a
 * different name. Two names for one shape is two things to change and one of
 * them gets missed; that they met in a single call path and compiled anyway is
 * structural typing being kind, not a design.
 */
export type { MemberPresence } from "./dto";

/**
 * Presence for every workspace member, keyed by user id, `online` derived
 * against PRESENCE_ONLINE_WINDOW_MS. One indexed query for the whole page.
 */
export async function presenceForWorkspace(
  workspaceId: string
): Promise<Map<string, MemberPresence>> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_presence")
    .select("user_id, last_seen_at")
    .eq("workspace_id", workspaceId)
    .limit(PRESENCE_ROWS_LIMIT);
  if (error) throw error;
  const cutoff = Date.now() - PRESENCE_ONLINE_WINDOW_MS;
  const out = new Map<string, MemberPresence>();
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

/**
 * ONE MEMBER'S PRESENCE — the PK lookup, for the caller's OWN row.
 *
 * ⚠ **A SIBLING OF {@link presenceForWorkspace}, NOT A DUPLICATE OF IT, AND THE
 * REASON IS THE HOT PATH** (2026-08-23, F-294). The session render joins the
 * CALLER'S own presence on every returned `await` hold — the one read the await
 * route already pays for is guarded by a paragraph about not multiplying the
 * feature's growing egress consumer, and pulling up to `PRESENCE_ROWS_LIMIT`
 * rows of a workspace to look at exactly one of them is the wrong shape to put
 * beside it. This is `(user_id, workspace_id)`, which is the table's PRIMARY KEY.
 * ⚠ `service-launch.ts › operatorIsOnline` still reads the whole workspace: it
 * runs once per `launch_agent`, which is cold, and re-pointing it belongs to a
 * change that can re-measure it rather than to this one.
 *
 * ⚠ **THE WINDOW IS THE SAME ONE, READ FROM THE SAME CONSTANT.** A second
 * liveness number would let the roster call a member offline while the session
 * surface told their orchestrator the machine was up.
 * ⚠ NO ROW, NO STAMP, OR AN UNREADABLE STAMP ALL READ AS OFFLINE — the fail-safe
 * direction every other presence reader picks. `null` here is not "unknown"; the
 * UNKNOWN case is the caller never calling this, which the render reads off an
 * ABSENT key.
 */
export async function presenceForUser(
  userId: string,
  workspaceId: string
): Promise<MemberPresence | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_presence")
    .select("last_seen_at")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  const lastSeenAt = (data as { last_seen_at: string } | null)?.last_seen_at;
  if (!lastSeenAt) return null;
  const seenAt = Date.parse(lastSeenAt);
  if (Number.isNaN(seenAt)) return { online: false, lastSeenAt };
  return {
    online: Date.now() - seenAt < PRESENCE_ONLINE_WINDOW_MS,
    lastSeenAt,
  };
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

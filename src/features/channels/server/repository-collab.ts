import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { POSTGREST_MAX_ROWS, readAllPages } from "@/shared/supabase/max-rows";
import type { ConsentRequestRow } from "./collab-dto";

/**
 * ⚠ Explicit row caps. PostgREST truncates an un-limited select SILENTLY against
 * its own `max-rows`, so any read feeding a derived count states its bound here.
 *
 * 🔒 **AND STATING ONE WAS NEVER ENOUGH (Samuel #2935, the `max_rows` sweep).**
 * `supabase/config.toml › max_rows` ({@link POSTGREST_MAX_ROWS}) clips every
 * select SERVER-SIDE and raises nothing, so a `.limit()` ABOVE it is not a bound
 * at all — it is a request the server silently declines. The member read below
 * asked 10,000 and was answered 1,000, with no error and no marker: a channel's
 * roster read SHORT, or EMPTY, and the online count beside it read zero. The
 * ceiling stays (it bounds a runaway walk and is still reported), but it is now
 * reached a page at a time through {@link readAllPages} rather than asked for in
 * one hopeful statement.
 * ⚠ The presence ceiling moved WITH its reads to `repository-presence.ts`; it was
 * always a different product (members × containers) and tying the two numbers
 * together would mean tuning one for the other's shape.
 */
const CONSENT_LIST_LIMIT = 200;
/** ⚠ EXPORTED (2026-08-20) so `repository.ts › memberCounts` shares it — two
 *  ceilings would be two answers to "how many members". */
export const CHANNEL_MEMBER_ROWS_LIMIT = 10_000;

/**
 * Pure data access for the collaboration tables: consent requests, and the
 * per-channel roster read the online counts pair with. ⚠ Service-role admin
 * client (RLS-bypassing) — visibility + authz live in the SERVICES.
 *
 * ⚠ **PRESENCE LEFT 2026-10-11** for `repository-presence.ts` (500-line cap, on
 * `repository-members.ts`' precedent) and is RE-EXPORTED from here, so this is
 * still the address every consumer imports.
 *
 * ⚠ The `agent_trust_rules` readers left 2026-08-22 with the table
 * (`20260822140000_retire_inbound_consent_and_trust.sql`) and the inbound
 * consent lane they auto-allowed; `expireRevokedAutoAllow` went with them.
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
 * How many `message_seq` values go into one `IN (…)` — PostgREST puts the list
 * in the query STRING, and an unbounded transcript builds a URL a proxy refuses.
 * Chunked rather than capped: a refused request is a silently unswept inbox.
 */
const CONSENT_SEQ_CHUNK = 100;

/**
 * EXPIRE — never delete — every PENDING consent row whose trigger message just
 * went away. The consent step of the thread cascade
 * (`service-tasks-delete.ts › deleteTask`).
 *
 * ⚠ EXPIRE, NOT DELETE: a decided row is the AUDIT of a human decision and a
 * thread deletion is nobody's licence to erase it; a still-`pending` row can
 * never be answered honestly.
 *
 * ⚠ THE KEY IS `message_seq`, clean despite having no FK: `seq` is TABLE-wide
 * identity (INVARIANTS §5) and the caller passes the seqs the delete ACTUALLY
 * removed. `channel_id` keeps the statement unable to reach another room.
 *
 * ⚠ NOT operator-scoped, unlike {@link expireStalePending} — every recipient
 * raises their OWN row against the same seq. Outbound rows carry `null` when
 * they answer no inbound ask, and a `null` never matches an `IN` list.
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
   * ⚠ REQUIRED, not optional. An operator-only filter returns pending rows from
   * EVERY workspace they belong to, and the sidebar's pending badge is built
   * from this list. Service role, so RLS is no backstop (and would scope to the
   * operator anyway — not the same bound).
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
 * up to 32KB of body_preview + proposed_reply EACH. A partial unique index backs
 * the key; `limit(1)` covers rows predating it.
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
 * ⚠ Explicitly multi-writer — the desktop dialog, its alert and the web card all
 * race for this row. A read-then-write lets a late Allow overwrite the human's
 * Deny; the `.eq("status","pending")` guard makes first-writer-wins a property
 * of the DATABASE, not of the interleaving.
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

// ⚠ `expireRevokedAutoAllow` DELETED 2026-08-22: no `auto_allowed` row can be
// born any more (inbound kind retired, `agent_trust_rules` dropped). The STATUS
// VALUE survives in `STATUS_FILTERS.decided` on purpose — retiring a writer is
// not a licence to hide history.

// ⚠ `findMessageAuthorBySeq` MOVED to `repository-messages.ts` (2026-08-20),
// which owns `channel_messages`. Still the consent path's; only its address
// changed.

// ─── Presence ───────────────────────────────────────────────────────
//
// ⚠ **MOVED TO `repository-presence.ts` (2026-10-11, 500-line cap)**, on
// `repository-members.ts`' precedent. RE-EXPORTED below rather than relocated
// out of reach: fourteen modules do `import * as collab from
// "./repository-collab"`, and the `max_rows` sweep is not the change that should
// also rewrite their import lines.
export {
  upsertPresence,
  upsertPresenceEverywhere,
  presenceForWorkspace,
  presenceForWorkspaces,
  presenceForUser,
} from "./repository-presence";
export type { MemberPresence } from "./dto";


/**
 * Member user-ids per channel — pairs with presence for online counts.
 *
 * 🔒 **PAGED (Samuel #2935).** It asked `.limit(CHANNEL_MEMBER_ROWS_LIMIT)` —
 * 10,000, the HIGHEST ask in this feature — and `max_rows` answered 1,000 with no
 * error: a page of busy channels came back with its last channels' rosters
 * missing or EMPTY, and the online count beside them read zero. The answer is the
 * per-channel list itself, so nothing can be folded in SQL.
 *
 * ⚠ **THE ORDER IS NEW AND TOTAL: `channel_id, user_id` IS `PRIMARY KEY
 * (channel_id, user_id)`.** This read had none, and an unordered page walk is the
 * worst case of the §-order rule — PostgREST may answer any permutation per page,
 * so one member could be listed twice in a channel (inflating its online count)
 * while another vanished. Grouping by `channel_id` first also keeps each
 * channel's rows contiguous, which is what makes the fold below cheap.
 */
export async function channelMemberUserIds(
  channelIds: string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (channelIds.length === 0) return out;
  const db = supabaseAdmin();
  const { rows } = await readAllPages<{ channel_id: string; user_id: string }>(
    // ⚠ A FRESH QUERY PER PAGE — one-shot thenable.
    async (from, toInclusive) => {
      const { data, error } = await db
        .from("channel_members")
        .select("channel_id, user_id")
        .in("channel_id", channelIds)
        .order("channel_id", { ascending: true })
        .order("user_id", { ascending: true })
        .range(from, toInclusive);
      return {
        data: (data ?? []) as unknown as Array<{
          channel_id: string;
          user_id: string;
        }>,
        error,
      };
    },
    { hardCap: CHANNEL_MEMBER_ROWS_LIMIT, pageSize: POSTGREST_MAX_ROWS }
  );
  for (const row of rows) {
    const list = out.get(row.channel_id);
    if (list) list.push(row.user_id);
    else out.set(row.channel_id, [row.user_id]);
  }
  return out;
}

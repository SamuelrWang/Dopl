import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { POSTGREST_MAX_ROWS, readAllPages } from "@/shared/supabase/max-rows";
import { HttpError } from "@/shared/lib/http-error";
import { PRESENCE_ONLINE_WINDOW_MS } from "../constants";
import type { AgentPresenceStatus, PresencePosture } from "../types";
import type { MemberPresence } from "./dto";
import type { ConsentRequestRow, PresenceRow } from "./collab-dto";

/**
 * ⚠ Explicit row caps. PostgREST truncates an un-limited select SILENTLY against
 * its own `max-rows`, so any read feeding a derived count states its bound here.
 *
 * 🔒 **AND STATING ONE WAS NEVER ENOUGH (Samuel #2935, the `max_rows` sweep).**
 * `supabase/config.toml › max_rows` ({@link POSTGREST_MAX_ROWS}) clips every
 * select SERVER-SIDE and raises nothing, so a `.limit()` ABOVE it is not a bound
 * at all — it is a request the server silently declines. Both presence reads and
 * the member read below asked 5,000 and 10,000 and were answered 1,000, with no
 * error and no marker: a member of a big workspace read as OFFLINE because their
 * row fell past the clip, and a channel's roster read SHORT. The two ceilings
 * stay (they bound a runaway walk and are still reported), but they are now
 * reached a page at a time through {@link readAllPages} rather than asked for in
 * one hopeful statement.
 */
const CONSENT_LIST_LIMIT = 200;
const PRESENCE_ROWS_LIMIT = 5_000;
/** ⚠ EXPORTED (2026-08-20) so `repository.ts › memberCounts` shares it — two
 *  ceilings would be two answers to "how many members". */
export const CHANNEL_MEMBER_ROWS_LIMIT = 10_000;

/**
 * Pure data access for the collaboration tables (consent requests, presence)
 * plus the presence read-helpers. ⚠ Service-role admin client (RLS-bypassing) —
 * visibility + authz live in the SERVICES.
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
 * ⚠ `DerivedPresence` GONE 2026-08-20 — it was `dto.ts › MemberPresence`
 * declared a second time under another name.
 */
export type { MemberPresence } from "./dto";

/**
 * THE ONLINE RULE, IN ONE PLACE — fresh enough AND not explicitly away.
 *
 * ⚠ **`status !== "away"`, NEVER `status === "active"`** (2026-09-08). Older
 * desktops still send `'listening'`, so an allow-list would take every
 * pre-posture machine offline on deploy day; an unheard-of status reads as
 * PRESENT-if-fresh.
 *
 * ⚠ An unparseable or absent stamp reads OFFLINE — the fail-safe direction every
 * presence reader in this tree picks.
 */
function derivePresence(
  lastSeenAt: string | null | undefined,
  status: string | null | undefined,
  now: number = Date.now()
): MemberPresence {
  if (!lastSeenAt) return { online: false, lastSeenAt: null };
  const seenAt = Date.parse(lastSeenAt);
  if (Number.isNaN(seenAt)) return { online: false, lastSeenAt };
  const fresh = now - seenAt < PRESENCE_ONLINE_WINDOW_MS;
  return { online: fresh && status !== "away", lastSeenAt };
}

/**
 * The three columns both presence scans project. ⚠ Declared once so the two page
 * walks below cannot drift to different shapes off one table.
 */
type PresenceScanRow = {
  user_id: string;
  last_seen_at: string;
  status: string | null;
};

/**
 * Presence for every workspace member, keyed by user id, `online` derived
 * against PRESENCE_ONLINE_WINDOW_MS. One indexed query for the whole page.
 *
 * ⚠ **THE SERVER IS THE ONLY THING THAT DECIDES `online` SINCE 2026-09-08** — a
 * client cannot see `status`, so one re-deriving the boolean from `lastSeenAt`
 * alone cannot agree. `view-model.ts › isPresent` now returns THIS flag.
 *
 * ── 🔒 PAGED, BECAUSE THE ANSWER IS THE MAP ────────────────────────────────
 *
 * 🔒 **ONE INDEXED QUERY WAS A WRONG ANSWER PAST 1,000 MEMBERS, NOT A SLOW ONE
 * (Samuel #2935).** The ask was `.limit(PRESENCE_ROWS_LIMIT)` — 5,000 — and the
 * server answered 1,000, silently; every member whose row fell past the clip was
 * ABSENT from this map, and an absent key reads OFFLINE at every caller
 * (`view-model.ts › isPresent`). Nothing is summed here, so no aggregate helps:
 * the answer IS the per-member map, which is {@link readAllPages}'s case.
 *
 * ⚠ **THE ORDER IS NEW AND IT IS LOAD-BEARING.** This read had NO `ORDER BY` at
 * all, which was harmless for one statement (the rows go into a map) and is the
 * WORST case for a page walk: PostgREST promises no row order, so an unordered
 * second page may repeat page one's rows and never return the rest. `PRIMARY KEY
 * (user_id, workspace_id)` with `workspace_id` pinned by the `.eq` below leaves
 * `user_id` UNIQUE within this read, so it is a total order on its own.
 */
export async function presenceForWorkspace(
  workspaceId: string
): Promise<Map<string, MemberPresence>> {
  const db = supabaseAdmin();
  const { rows } = await readAllPages<PresenceScanRow>(
    // ⚠ A FRESH QUERY PER PAGE. A Supabase builder is a one-shot thenable;
    // re-awaiting one re-sends the first range and the walk spins on page 0.
    async (from, toInclusive) => {
      const { data, error } = await db
        .from("agent_presence")
        .select("user_id, last_seen_at, status")
        .eq("workspace_id", workspaceId)
        .order("user_id", { ascending: true })
        .range(from, toInclusive);
      return { data: (data ?? []) as unknown as PresenceScanRow[], error };
    },
    // ⚠ The page size is the SERVER's ceiling, which is what makes a short page
    // proof of exhaustion rather than proof of a clip.
    { hardCap: PRESENCE_ROWS_LIMIT, pageSize: POSTGREST_MAX_ROWS }
  );
  const now = Date.now();
  const out = new Map<string, MemberPresence>();
  for (const row of rows) {
    out.set(row.user_id, derivePresence(row.last_seen_at, row.status, now));
  }
  return out;
}

/**
 * Presence across MANY containers in ONE statement — what `scope=account` needs,
 * since that read spans every container the caller belongs to (Wave 3, R-26).
 *
 * ⚠ **ONE `.in()`, NEVER A LOOP OVER `presenceForWorkspace`.** A per-container fan
 * is the shape §9 forbids, and the per-workspace heartbeat loop below is the
 * worked example of what it costs at 13+ containers.
 *
 * ⚠ **KEYED BY USER ID, so a member of N containers collapses to ONE entry** —
 * which is right: presence is a property of the PERSON's machine, not of a room.
 *
 * 🔒 ⚠ **THE FRESHEST STAMP WINS, AND "LAST ROW READ" WOULD NOT DO.** The rows
 * agree only while `upsertPresenceEverywhere` is the writer; the per-workspace
 * FALLBACK loop it replaced stamps them one at a time and is exactly what let tail
 * rows age past the online window. PostgREST promises no row order, so picking by
 * arrival would flip a member between online and offline across two identical
 * reads. `last_seen_at` is the only total order here, and taking its maximum is
 * also the honest one: the machine was up at the latest instant anything saw it.
 *
 * ── 🔒 PAGED, AND THIS READ MULTIPLIES ROWS BY CONTAINERS ──────────────────
 *
 * 🔒 **IT ASKED 5,000 AND WAS ANSWERED 1,000, SILENTLY (Samuel #2935).** One row
 * per (member × container) is the widest presence read in the tree — the very
 * shape `scope=account` exists for — so it reaches the clip FIRST, and reaching
 * it drops members out of the map entirely, where an absent key reads OFFLINE.
 * ⚠ Worse than the per-workspace read: a member present in container 13 but
 * clipped out of the page was reported offline *while their machine was awake*,
 * which is the same symptom the heartbeat fan-out below was rewritten to end.
 *
 * ⚠ **THE ORDER IS TOTAL ONLY WITH `workspace_id`, AND THAT IS THE WHOLE POINT
 * HERE.** `user_id` ALONE IS NOT UNIQUE in this read — a member of N containers
 * has N rows, which is exactly why the freshest-wins fold below exists. Ordering
 * by `user_id` and stopping there would let one member's rows straddle a page
 * boundary in an undefined order, so a page could repeat one of them and SKIP
 * another — and a skipped row is a lost maximum, which flips the member offline.
 * The tie-break runs down to `PRIMARY KEY (user_id, workspace_id)`.
 * ⚠ The order is NOT `last_seen_at`: the maximum is taken in JS, and paging on a
 * non-unique timestamp is the trap this paragraph describes.
 */
export async function presenceForWorkspaces(
  workspaceIds: string[]
): Promise<Map<string, MemberPresence>> {
  const out = new Map<string, MemberPresence>();
  if (workspaceIds.length === 0) return out;
  const db = supabaseAdmin();
  const { rows } = await readAllPages<PresenceScanRow>(
    // ⚠ A FRESH QUERY PER PAGE — the one-shot-thenable rule above.
    async (from, toInclusive) => {
      const { data, error } = await db
        .from("agent_presence")
        .select("user_id, last_seen_at, status")
        .in("workspace_id", workspaceIds)
        .order("user_id", { ascending: true })
        .order("workspace_id", { ascending: true })
        .range(from, toInclusive);
      return { data: (data ?? []) as unknown as PresenceScanRow[], error };
    },
    { hardCap: PRESENCE_ROWS_LIMIT, pageSize: POSTGREST_MAX_ROWS }
  );
  const now = Date.now();
  const freshest = new Map<string, { last_seen_at: string; status: string | null }>();
  for (const row of rows) {
    const held = freshest.get(row.user_id);
    if (
      held === undefined ||
      Date.parse(row.last_seen_at) > Date.parse(held.last_seen_at)
    ) {
      freshest.set(row.user_id, row);
    }
  }
  for (const [userId, row] of freshest) {
    out.set(userId, derivePresence(row.last_seen_at, row.status, now));
  }
  return out;
}

/**
 * ONE STATEMENT, EVERY CONTAINER — the user-scoped heartbeat (2026-09-08).
 *
 * ⚠ **THE PER-WORKSPACE LOOP DID NOT SCALE WITH MEMBERSHIP COUNT — the reported
 * bug.** Serial posts, 12 s timeout each, on a 30 s interval: an operator in 13+
 * containers overran the interval, the next tick was SKIPPED, and tail rows aged
 * past the online window while the machine was awake.
 *
 * ⚠ **THE RPC IS `SECURITY DEFINER` OVER A CALLER-SUPPLIED SUBJECT AND IS
 * SERVICE-ROLE-ONLY** (`20260930140000_presence_heartbeat_all.sql`). Reached
 * from here and nowhere else; `userId` is server-resolved by `withUserAuth`.
 *
 * ⚠ **A MISSING FUNCTION IS A 404, NOT A 500.** The migration is written-not-
 * applied (§12), and `main/presence-core.js` drops to the per-workspace loop on
 * 404 and on nothing else. The message check belts a PostgREST that ever stops
 * setting `PGRST202`.
 *
 * @returns the workspace ids stamped (possibly empty — an operator in zero
 *   containers is an ANSWER, not a failure).
 */
export async function upsertPresenceEverywhere(
  userId: string,
  status: PresencePosture
): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("presence_heartbeat_all", {
    p_user_id: userId,
    p_status: status,
  });
  if (error) {
    if (
      error.code === "PGRST202" ||
      /could not find the function/i.test(error.message ?? "")
    ) {
      throw new HttpError(
        404,
        "PRESENCE_HEARTBEAT_ALL_UNAVAILABLE",
        "presence_heartbeat_all is not deployed on this database"
      );
    }
    throw error;
  }
  return ((data ?? []) as Array<{ workspace_id: string }>).map(
    (row) => row.workspace_id
  );
}

/**
 * ONE MEMBER'S PRESENCE — the PK lookup, for the caller's OWN row.
 *
 * ⚠ **A SIBLING OF {@link presenceForWorkspace}, NOT A DUPLICATE, AND THE REASON
 * IS THE HOT PATH** (2026-08-23, F-294). The session render joins the CALLER'S
 * own presence on every returned `await` hold, so pulling `PRESENCE_ROWS_LIMIT`
 * rows to look at one of them is the wrong shape; this is the PRIMARY KEY.
 * ⚠ `service-launch.ts › operatorIsOnline` still reads the whole workspace — it
 * runs once per `launch_agent`, and re-pointing it needs its own measurement.
 *
 * ⚠ **THE WINDOW IS THE SAME CONSTANT.** A second liveness number would let the
 * roster call a member offline while the session surface said the machine was up.
 * ⚠ NO ROW, NO STAMP, OR AN UNREADABLE STAMP ALL READ AS OFFLINE. `null` here is
 * not "unknown" — UNKNOWN is the caller never calling this, read off an ABSENT key.
 */
export async function presenceForUser(
  userId: string,
  workspaceId: string
): Promise<MemberPresence | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_presence")
    .select("last_seen_at, status")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { last_seen_at: string; status: string | null } | null;
  if (!row?.last_seen_at) return null;
  // ⚠ THE SAME `derivePresence` THE WORKSPACE READ USES — a second copy of the
  // rule would let the two surfaces disagree about one machine (2026-09-08).
  return derivePresence(row.last_seen_at, row.status);
}

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

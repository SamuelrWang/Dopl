import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { MENTIONS_METADATA_KEY } from "@/features/channels/lib/mentions";

/**
 * WHAT IS BLOCKED ON THE OPERATOR — the three reads behind /home Overview's
 * **Waiting on you** panel (Samuel, 2026-09-01).
 *
 * ⚠ **A SEPARATE FILE FROM `repository-overview.ts`, AND THE SEAM IS REAL.**
 * That one answers "how much happened" — windowed counts and bounded scans over
 * analytics-shaped tables. This one answers "what is stuck", which is live
 * state, is fenced by the CALLER as well as by the container list, and changes
 * when the product grows a new way to block somebody. One file per reason to
 * change (INVARIANTS §1).
 *
 * 🔒 **EVERY READ HERE TAKES BOTH FENCES AND NEEDS BOTH.** `workspaceIds` is the
 * caller's home containers (`repository-containers.ts › listLinkContainers`,
 * the page's standing fence); `userId` is the caller. These run service-role and
 * bypass RLS, so a read fenced only by container would answer "what is blocking
 * ANYBODY in this relationship" — which on a two-person container is a readout
 * of the peer's pending decisions.
 *
 * ⚠ **WHAT THE SERVER CANNOT SEE, STATED ONCE.** A tool-gate prompt — its text,
 * the tool it names, the choices — lives in the DESKTOP, in main's gate
 * (`dopl-desktop-app/main/session-gate-bridge.js`), and never crosses the wire.
 * What the server has is `channel_sessions.detail`, a best-effort push from that
 * machine carrying one of six closed keys. So this surface can say **that** a
 * session is waiting on a permission and where it is; it cannot say what is
 * being asked, and it goes blind entirely if the desktop never pushed. That is a
 * limit of the model, not of this file — do not "fix" it by inventing a
 * question.
 */

/** How long a scan of any one lane may run to. These are glance lists. */
export const ATTENTION_LIMIT = 20;

export interface ConsentRequestRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  summary: string;
  created_at: string;
}

/**
 * OUTBOUND SENDS AWAITING THE OPERATOR'S DECISION — the strongest "waiting on
 * you" there is: an agent has drafted a message and cannot send it until this
 * person answers.
 *
 * 🔒 **`operator_user_id = caller` IS THE FENCE THE TABLE WAS BUILT WITH** — the
 * column's own comment in `20260726100000_channel_consent_requests.sql` is "who
 * must decide". Nothing else may be used to select these rows.
 *
 * ⚠ **`status = 'pending'` AND NOT YET EXPIRED.** The table's five-value status
 * carries `expired` as a real state, but the sweep that stamps it is LAZY (on
 * read, by the channels service), so a row can be `pending` with an elapsed
 * `expires_at` and is NOT waiting on anybody. Filtering on the timestamp as well
 * as the word is what keeps a dead card off this panel. ⚠ A NULL `expires_at`
 * never expires — the column is nullable and the filter must not drop those.
 *
 * ⚠ **`kind` IS NOT FILTERED, deliberately.** Inbound consent was retired in
 * 2026-08-23; if a legacy inbound row is still pending it is still a decision
 * this person owes, and hiding it would strand it.
 */
export async function listPendingConsent(
  workspaceIds: string[],
  userId: string,
  limit: number = ATTENTION_LIMIT
): Promise<ConsentRequestRow[]> {
  if (workspaceIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("channel_consent_requests")
    .select("id, workspace_id, channel_id, summary, created_at")
    .in("workspace_id", workspaceIds)
    .eq("operator_user_id", userId)
    .eq("status", "pending")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ConsentRequestRow[];
}

export interface HeldSessionRow {
  id: string;
  workspace_id: string;
  task_id: string | null;
  name: string;
  display_name: string | null;
  thread_title: string | null;
  updated_at: string;
}

/**
 * THE CALLER'S OWN AGENTS SITTING ON A PERMISSION PROMPT.
 *
 * 🔒 **`user_id = caller` IS A FENCE AND NOT A CONVENIENCE.** A permission
 * prompt is answered on the machine RUNNING the session; a peer's held agent is
 * not this operator's to unblock, and listing it would be telling them about a
 * decision they cannot take. It is also the same fence that keeps this read off
 * the operator-only telemetry columns — none of which are selected here.
 *
 * ⚠ **`detail = 'permission'` IS THE ONLY KEY THAT MEANS "BLOCKED ON YOU".** Of
 * the six (`thinking` / `tool` / `posting` / `permission` / `awaiting_peer` /
 * `awaiting_inbound`), the last two mean waiting on somebody ELSE and belong
 * nowhere near this panel; the first three are work in progress.
 *
 * ⚠ **`state != 'ended'`, because `detail` IS NOT CLEARED ON TEARDOWN.** An
 * ended session keeps whatever key it last pushed, so filtering on `detail`
 * alone resurrects every agent that ever paused for permission.
 */
export async function listPermissionHeldSessions(
  workspaceIds: string[],
  userId: string,
  limit: number = ATTENTION_LIMIT
): Promise<HeldSessionRow[]> {
  if (workspaceIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("channel_sessions")
    .select("id, workspace_id, task_id, name, display_name, thread_title, updated_at")
    .in("workspace_id", workspaceIds)
    .eq("user_id", userId)
    .eq("detail", "permission")
    .neq("state", "ended")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as HeldSessionRow[];
}

export interface MentionRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  body: string;
  created_at: string;
}

/**
 * MESSAGES THAT TAG THE CALLER AND THAT THE CALLER HAS NOT READ — the closest
 * the server gets to "an agent asked you a question".
 *
 * ⚠ **THAT FRAMING IS AN APPROXIMATION AND THE PANEL MUST NOT OVERSELL IT.**
 * There is no "question" kind on `channel_messages` (the CHECK is
 * `message | task_started | task_progress | task_finished | task_failed |
 * system`), so a question is an ordinary message. What makes one ADDRESSED is
 * the @-mention, which is stamped into `metadata->mentionedUserIds` at write
 * time. An agent that asks without tagging anybody is invisible here, and no
 * read can recover it.
 *
 * ⚠ **THE CONTAINMENT ARGUMENT IS A STRING, NOT AN ARRAY** — `postgrest-js`
 * renders an array as a PostgreSQL array literal (`{a,b}`), which is the wrong
 * type against a jsonb path. The same shape `channels/server/repository-mentions.ts
 * › mentionContainment` uses, and answered by the same GIN index
 * (`channel_messages_mentions_idx`, `jsonb_path_ops`).
 *
 * ⚠ **THE READ-STATE ANTI-JOIN IS A SECOND STATEMENT, BOUNDED BY THE FIRST'S
 * PAGE.** PostgREST has no `NOT EXISTS`, so this reads at most `limit` candidate
 * ids and asks which of THOSE are already read — never the whole read table.
 * ⚠ It costs at most two statements regardless of how many containers the
 * caller has, which is the §9 shape; a per-channel version would be a fan-out.
 */
export async function listUnreadMentions(
  workspaceIds: string[],
  userId: string,
  limit: number = ATTENTION_LIMIT
): Promise<MentionRow[]> {
  if (workspaceIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("id, workspace_id, channel_id, body, created_at")
    .in("workspace_id", workspaceIds)
    .eq("kind", "message")
    .contains(`metadata->${MENTIONS_METADATA_KEY}`, JSON.stringify([userId]))
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as MentionRow[];
  if (rows.length === 0) return [];

  const { data: read, error: readError } = await db
    .from("channel_mention_reads")
    .select("message_id")
    .eq("user_id", userId)
    .in(
      "message_id",
      rows.map((row) => row.id)
    );
  if (readError) throw readError;
  const seen = new Set(
    ((read ?? []) as Array<{ message_id: string }>).map((row) => row.message_id)
  );
  return rows.filter((row) => !seen.has(row.id));
}

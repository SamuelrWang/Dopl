import type {
  ChannelConsentRequest,
  ChannelSessionState,
  ChannelSessionStateOwn,
  ConsentKind,
  ConsentStatus,
  SessionDetailKey,
  SessionPillState,
} from "../types";
import type { ProfileRef } from "./dto";

/**
 * DB row shapes + mappers for the v1.2 collaboration tables
 * (`channel_consent_requests`, `agent_presence`).
 * Hand-written rather than pulled from the generated `Database` type — the
 * same cast-at-the-boundary pattern the rest of the channels feature uses,
 * since the repository talks to the untyped `supabaseAdmin()` client.
 *
 * ⚠ THERE WAS A THIRD TABLE, `agent_trust_rules`, and `TrustRuleRow` /
 * `mapTrustRow` are DELETED with it (2026-08-22 — the table is dropped in
 * `20260822140000_retire_inbound_consent_and_trust.sql`). It only ever auto-allowed
 * INBOUND consent requests, and that lane is retired; a row shape for a relation
 * that does not exist is a type that compiles and can never be satisfied.
 */

export type ConsentRequestRow = {
  id: string;
  channel_id: string;
  workspace_id: string;
  operator_user_id: string;
  requester_user_id: string | null;
  kind: string;
  message_seq: number | string | null;
  summary: string;
  body_preview: string;
  proposed_reply: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  expires_at: string | null;
};

export type PresenceRow = {
  user_id: string;
  workspace_id: string;
  last_seen_at: string;
  status: string;
};

/**
 * `channel_sessions` row — the desktop's per-session projection at rest (rollback
 * §3.5, read-session-state). One row per live session the operator's machine is
 * running; `mapSessionStateRow` turns it into the {@link ChannelSessionState}
 * the MCP read returns.
 */
export type SessionStateRow = {
  id: string;
  channel_id: string;
  workspace_id: string;
  user_id: string;
  session_key: string;
  task_id: string | null;
  name: string;
  state: string;
  channel_name: string | null;
  thread_title: string | null;
  created_at: string;
  updated_at: string;
  /** One of six CLOSED situation keys (`session-detail.js › detailFor`).
   *  Peer-visible — and peer-visible ONLY because the vocabulary is closed.
   *  ⚠ Typed `string | null` at the ROW because the column is TEXT and a newer
   *  desktop may store a seventh key; `narrowSessionDetail` is what turns it
   *  into a value a surface may render. */
  detail: string | null;
  // ── OPERATOR-ONLY TELEMETRY (20260822150000, Samuel's ruling) ────────────
  // ⚠ NULL IS "UNKNOWN", NEVER ZERO. A desktop that does not report a number
  // has not reported that its agent spent nothing; the render says so.
  tool_label: string | null;
  model: string | null;
  context_used: number | string | null;
  context_window: number | string | null;
  tokens_spent: number | string | null;
  started_at: string | null;
  last_activity_at: string | null;
  // ── OPERATOR-ONLY HEALTH (20260909120000) ───────────────────────────────
  // "Is this agent GETTING ANYWHERE", as the seven facts
  // `dopl-desktop-app/main/session-health.js` derives. ⚠ SAME NULL RULE, and it
  // bites harder because six of the seven are counts: a `0` here would report
  // that nothing was denied to an agent whose every call is being refused.
  // ⚠ `stale` IS THE MACHINE'S OWN WEDGED FLAG (working + silent + still
  // spending) and is NOT the row-freshness fact
  // `packages/mcp-server/src/tools/channel-session-render.ts › sessionIsStale`
  // derives from `updated_at`. Same word, two facts — see
  // `channel-session-health.ts`, which renders them as different clauses.
  //
  // ⚠ `| string` ON THE TWO BIGINTS AND NOT ON THE TWO INTEGERS, DELIBERATELY.
  // PostgREST hands an INT8 back as a STRING when it will not fit a JS number,
  // which is why {@link bigintOrNull} exists; INT4 always arrives as a number.
  // The column types are the migration's (`20260909120000`) and this restates
  // them rather than widening everything "just in case" — a union that admits a
  // value the column cannot hold is a type that has stopped describing the row.
  turns: number | null;
  tokens_delta: number | string | null;
  stale: boolean | null;
  denied_calls: number | null;
  last_denied_tool: string | null;
  last_wake_seq: number | string | null;
  last_wake_at: string | null;
  /** ⚠ NOT TELEMETRY, AND OPERATOR-ONLY FOR ITS OWN REASONS (20260823130000,
   *  Samuel's OQ-5 ruling). The name of the agent template this session was
   *  launched from, SNAPSHOTTED AT SPAWN — deliberately not an FK, so a session
   *  goes on reporting what it RAN AS after the template is renamed or deleted.
   *  It sits in this block because the AUDIENCE is the same one, which is the
   *  only thing {@link OPERATOR_ONLY_SESSION_COLUMNS} is about: it is
   *  operator-authored free text (the `detail` ruling's own stated condition for
   *  going private), and a private template's name on a peer's screen is an
   *  existence oracle for a row that has no name uniqueness precisely so that it
   *  cannot be probed. NULL = no template, or a desktop older than the field. */
  template_name: string | null;
  /** THE OPERATOR-GIVEN AGENT NAME — **PEER-VISIBLE BY DESIGN** (2026-08-31,
   *  20260905120000; Samuel's ruling: the other member should see you are
   *  running a "Bug Reviewer"). ⚠ DELIBERATELY NOT in
   *  {@link OPERATOR_ONLY_SESSION_COLUMNS} — visibility is its point, and unlike
   *  `template_name` it is an instance label with no existence-oracle behind it.
   *  NULL = never named (render falls back to the `name` handle), or a desktop
   *  older than the field. */
  display_name: string | null;
};

/**
 * THE FENCE, AS DATA — the columns a PEER may never read, and the DTO fields
 * they map to.
 *
 * ⚠ Exported so the visibility split is TESTABLE AS A PROPERTY rather than as a
 * list of examples: `session-visibility.test.ts` asserts that no key in the
 * peer mapper's output is one of these, for every row it is handed. A new
 * telemetry column is added HERE first, and the property test then covers it
 * without anyone remembering to write a case for it.
 *
 * ⚠ The two arrays are parallel by construction and pinned as such — a column
 * added to one and not the other is a fence with a hole and a green suite.
 *
 * ⚠ **"OPERATOR-ONLY" IS AN AUDIENCE, NOT A SUBJECT.** Eight of the fifteen are
 * telemetry (what an agent runs on and what it costs); `template_name` is an
 * IDENTITY snapshot and joined on 2026-08-23; the seven HEALTH entries joined on
 * 2026-09-01 and are about progress rather than cost. Nothing here is about
 * measurement — the one question this array asks is "may a PEER read it", and
 * the answer for every entry is no.
 *
 * ⚠ THE HEALTH SEVEN ARE NOT A CLOSE CALL. `denied_calls` / `last_denied_tool`
 * are the sharpest of the whole set: they publish what an operator's tool policy
 * REFUSES, which is a map of that operator's machine, and no peer has any claim
 * on it.
 */
export const OPERATOR_ONLY_SESSION_COLUMNS = [
  "tool_label",
  "model",
  "context_used",
  "context_window",
  "tokens_spent",
  "started_at",
  "last_activity_at",
  "template_name",
  "turns",
  "tokens_delta",
  "stale",
  "denied_calls",
  "last_denied_tool",
  "last_wake_seq",
  "last_wake_at",
] as const;

export const OPERATOR_ONLY_SESSION_FIELDS = [
  "toolLabel",
  "model",
  "contextUsed",
  "contextWindow",
  "tokensSpent",
  "startedAt",
  "lastActivityAt",
  "templateName",
  "turns",
  "tokensDelta",
  "stale",
  "deniedCalls",
  "lastDeniedTool",
  "lastWakeSeq",
  "lastWakeAt",
] as const;

/**
 * ONE ROW AS THE DESKTOP REPORTS IT (rollback §3.5, the write half). Column
 * names, because this is what goes to the database — the API's camelCase shape
 * is `SessionStateEntryInput` and the service maps between them.
 *
 * `user_id` and `workspace_id` are ABSENT ON PURPOSE: they come from the
 * authenticated context and never from a caller's payload, so there is no field
 * here for a caller to put someone else's id in. The repository stamps both.
 */
export type SessionStateUpsert = {
  session_key: string;
  channel_id: string;
  task_id: string | null;
  name: string;
  state: string;
  channel_name: string | null;
  thread_title: string | null;
  detail: string | null;
  tool_label: string | null;
  model: string | null;
  context_used: number | null;
  context_window: number | null;
  tokens_spent: number | null;
  started_at: string | null;
  last_activity_at: string | null;
  // ── HEALTH (2026-09-01, 20260909120000) ─────────────────────────────────
  // ⚠ NUMBERS ONLY ON THE WRITE SIDE — the reported value has already been
  // through zod, so there is no `string` case here the way there is on
  // {@link SessionStateRow}: that union describes what PostgREST HANDS BACK, and
  // this one describes what the service WRITES. ⚠ Every one is nullable and
  // never defaulted; see `session-state-service.ts › toUpsert`.
  turns: number | null;
  tokens_delta: number | null;
  stale: boolean | null;
  denied_calls: number | null;
  last_denied_tool: string | null;
  last_wake_seq: number | null;
  last_wake_at: string | null;
  /** 2026-08-31 (20260905120000): the operator-given agent name; peer-visible. */
  display_name: string | null;
  /** ⚠ A SNAPSHOT THE DESKTOP REPORTS, NOT A LOOKUP THE SERVER PERFORMS. The
   *  server never resolves a template id here — main holds the resolved template
   *  on `context.template` from spawn (spec §3d) and reports its NAME, which is
   *  what keeps the row true after a rename or a delete. */
  template_name: string | null;
};

/**
 * THE SIX KEYS `channel_sessions.detail` MAY RENDER AS — a MEMBERSHIP TEST, not
 * a cast.
 *
 * ⚠ **THIS IS WHAT KEEPS `detail` PEER-SAFE, AND IT IS THE WHOLE ARGUMENT FOR
 * LETTING THE COLUMN CROSS TO A PEER AT ALL.** The field is peer-visible ONLY
 * because it is one of six fixed, coarse words. Free-form prose in it — "reading
 * 4 files in ~/clients/acme" — is operator-only material, and a mapper that
 * passed the column through would ship it to every member of the channel. So the
 * column is narrowed HERE, on the way out, and anything outside the set becomes
 * `null` (= "no refinement reported").
 *
 * ⚠ **THE WRITE PATH IS DELIBERATELY LOOSER THAN THIS, AND THAT ASYMMETRY IS ON
 * PURPOSE.** `schema-sessions.ts` accepts any short safe label rather than a
 * `z.enum`, because zod validates the ARRAY: a desktop shipping a SEVENTH key
 * would otherwise 400 its entire push, `retryable(400)` is false, and that
 * machine's `read_sessions` would answer `[]` forever (INVARIANTS §11, §13). So
 * a newer key STORES fine and simply renders as nothing until the server learns
 * it — which is exactly what `agents-model.ts › agentDetailLabel` already does
 * with an unknown key, and the fail-CLOSED direction either way.
 *
 * ⚠ The set is DERIVED from the shared type, so it cannot drift from
 * `spa-bridge-shapes.ts`; `session-visibility.test.ts` pins the array against
 * that file's declaration.
 */
const SESSION_DETAIL_KEYS: ReadonlySet<string> = new Set<SessionDetailKey>([
  "thinking",
  "tool",
  "posting",
  "permission",
  "awaiting_peer",
  "awaiting_inbound",
]);

export function narrowSessionDetail(
  value: string | null | undefined
): SessionDetailKey | null {
  if (typeof value !== "string") return null;
  return SESSION_DETAIL_KEYS.has(value) ? (value as SessionDetailKey) : null;
}

/**
 * A BIGINT off PostgREST, as a number — or `null`.
 *
 * ⚠ `null` MEANS UNKNOWN AND MUST SURVIVE AS `null`. `Number(null)` is `0`, and
 * a 0 here renders as "this agent has spent no tokens", which is a claim the
 * row never made. Same rule for a value that does not parse: unknown, not zero.
 */
function bigintOrNull(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * THE PEER PROJECTION — what a member of the channel may see of ANOTHER
 * member's session (Samuel's ruling, 2026-08-22: telemetry is OPERATOR-ONLY,
 * peers keep coarse).
 *
 * ⚠ THIS FUNCTION IS THE FENCE, and it is a fence because it BUILDS a narrow
 * object rather than deleting keys from a wide one. A `delete`-based or
 * `omit`-based scrub fails OPEN when a column is added; construction fails
 * CLOSED, because a new field reaches a peer only when somebody types its name
 * here. The column-privilege GRANT in `20260822150000` is the belt; **this is
 * the load-bearing half**, because every read in `repository-sessions.ts` runs
 * on the RLS- and grant-bypassing admin client.
 *
 * ⚠ THERE IS DELIBERATELY NO `mapSessionStateRow` ANY MORE. One mapper with an
 * audience argument has a default, and a default is how the rich shape reaches
 * a peer surface that forgot to pass the argument. Two names, no default: a
 * call site must say whose eyes it is rendering for.
 *
 * ⚠ `channelId` IS KEPT even though it is not in the coarse projection's
 * charter. It is the ROUTING KEY the caller already supplied (this read is
 * channel-scoped by construction), not a fact about anybody's machine, and
 * `hooks/use-channel-agent-sessions.ts › ChannelPeerSession` is typed on it.
 * ⚠ The wire name stays `threadId`, not `taskId` — the §5 boundary rule
 * (storage says `task`, the wire and the domain say `thread`).
 */
export function mapPeerSessionStateRow(
  row: SessionStateRow
): ChannelSessionState {
  return {
    channelId: row.channel_id,
    threadId: row.task_id,
    name: row.name,
    // The column carries a CHECK constraint on exactly these three values, and
    // this is the same cast the rest of this file makes for the untyped admin
    // client.
    //
    // F-145 — IT IS AN ASSERTION, NOT A CHECK, and the migration it leans on is
    // still UNAPPLIED (Samuel's gate), so today it leans on nothing. F-147's
    // writer validates `state` against the same closed set on the way IN, which
    // is a second layer and not a replacement for this one. The value
    // ends up spliced into `dopl_channel(op="read_sessions")`'s SERVER
    // NARRATION, so the layer that actually holds is the render's closed-set
    // test (`channel-ops-read.formatSessionLine`), which says
    // "(unrecognized state)" rather than emitting whatever the row carried.
    // Named here so the next reader does not take this cast for a guarantee.
    state: row.state as SessionPillState,
    // ⚠ NARROWED, NEVER PASSED THROUGH — see `narrowSessionDetail`. This is the
    // one line that keeps a free-form value in the column from reaching a peer.
    detail: narrowSessionDetail(row.detail),
    channelName: row.channel_name,
    threadTitle: row.thread_title,
    // ⚠ PEER-VISIBLE BY DESIGN (2026-08-31, Samuel's ruling) — the operator-given
    // agent name IS for the other member's eyes; bounded at the schema and the
    // column CHECK both. `?? null` covers a row read before the migration.
    displayName: row.display_name ?? null,
    updatedAt: row.updated_at,
  };
}

/**
 * THE OWNER PROJECTION — the caller's OWN sessions, telemetry included.
 *
 * ⚠ Reachable from exactly two places, both own-scoped by the repository's
 * `user_id` fence: `listSessionStates` (→ `GET /api/channels/sessions` →
 * `read_sessions`) and the await route's return-time session block. If a third
 * call site appears, the question to answer first is whether its fence is
 * `ctx.userId`; if it is not, it wants {@link mapPeerSessionStateRow}.
 */
export function mapOwnSessionStateRow(
  row: SessionStateRow
): ChannelSessionStateOwn {
  return {
    ...mapPeerSessionStateRow(row),
    model: row.model,
    toolLabel: row.tool_label,
    contextUsed: bigintOrNull(row.context_used),
    contextWindow: bigintOrNull(row.context_window),
    tokensSpent: bigintOrNull(row.tokens_spent),
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
    // ⚠ THE ONLY MAPPER THAT MAY NAME THIS FIELD. A peer seeing it learns that a
    // template with that name exists on somebody else's account — and
    // `agent_templates` deliberately has no name uniqueness so that nothing can
    // be probed that way. Adding it to {@link mapPeerSessionStateRow} would undo
    // both that decision and the 404-not-403 rule in one line.
    templateName: row.template_name,
    // ── THE HEALTH HALF (2026-09-01, 20260909120000) ────────────────────────
    // ⚠ `bigintOrNull` ON ALL FOUR COUNTS, INCLUDING THE TWO INT4s. The two
    // BIGINTs genuinely need it (PostgREST may hand an INT8 back as a string);
    // the two INTEGERs are run through the same helper because its OTHER
    // guarantee is the one that matters everywhere — `null` survives as `null`
    // and an unparseable value becomes `null` rather than `0`. A bare
    // `Number(row.turns)` would turn "this machine counted nothing" into "this
    // agent has taken no turns", which is the one lie this whole wave is about.
    turns: bigintOrNull(row.turns),
    tokensDelta: bigintOrNull(row.tokens_delta),
    // ⚠ NOT COERCED, AND NOT DEFAULTED TO `false`. The desktop always sends a
    // boolean (`session-telemetry.js` writes `x.stale === true`), so a NULL here
    // means the column predates the writer — "nothing has evaluated whether this
    // session is wedged", which is not the same claim as "it is not wedged".
    // `?? false` here would state the second on behalf of a machine that said
    // neither. ⚠ It is the MACHINE's wedged flag and never the row-freshness
    // fact of the same name; see {@link SessionStateRow}.
    stale: row.stale,
    deniedCalls: bigintOrNull(row.denied_calls),
    lastDeniedTool: row.last_denied_tool,
    lastWakeSeq: bigintOrNull(row.last_wake_seq),
    lastWakeAt: row.last_wake_at,
  };
}

export function mapConsentRow(
  row: ConsentRequestRow,
  requester: ProfileRef | undefined
): ChannelConsentRequest {
  return {
    id: row.id,
    channelId: row.channel_id,
    workspaceId: row.workspace_id,
    operatorUserId: row.operator_user_id,
    requesterUserId: row.requester_user_id,
    kind: row.kind as ConsentKind,
    messageSeq: row.message_seq === null ? null : Number(row.message_seq),
    summary: row.summary,
    bodyPreview: row.body_preview,
    proposedReply: row.proposed_reply,
    status: row.status as ConsentStatus,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    requesterName: requester?.display_name || requester?.email || null,
    requesterAvatarUrl: requester?.avatar_url ?? null,
  };
}

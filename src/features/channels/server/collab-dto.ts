import { agentColorOrNull } from "../lib/agent-colors";
import type {
  AgentColorKey,
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
 * Row shapes + mappers for `channel_consent_requests`, `agent_presence` and `channel_sessions`;
 * hand-written because the repository talks to the untyped `supabaseAdmin()` client.
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

/** `channel_sessions` row: one per live session the operator's machine reports. */
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
  /** TEXT: a newer desktop may store an unknown key; `narrowSessionDetail` makes it renderable. */
  detail: string | null;
  // Operator-only telemetry. NULL is unknown, never zero.
  tool_label: string | null;
  model: string | null;
  context_used: number | string | null;
  context_window: number | string | null;
  tokens_spent: number | string | null;
  started_at: string | null;
  last_activity_at: string | null;
  // Operator-only health (`main/session-health.js`), same null rule. `stale` is the machine's wedged
  // flag, not `channel-session-render.ts › sessionIsStale` (row freshness from `updated_at`).
  // `| string` only on the BIGINTs: PostgREST may return an INT8 as a string; INT4 is always a number.
  turns: number | null;
  tokens_delta: number | string | null;
  stale: boolean | null;
  denied_calls: number | null;
  last_denied_tool: string | null;
  last_wake_seq: number | string | null;
  last_wake_at: string | null;
  /** Identity name snapshotted at spawn (not an FK). Operator-only: on a peer's screen it is an
   *  existence oracle for a private identity. NULL = no identity, or an older desktop. */
  identity_name: string | null;
  /** Operator-given agent name, peer-visible by design. NULL = never named (render falls back to `name`). */
  display_name: string | null;
  /** Peer-visible by design (every member draws it); TEXT, so `narrowSessionColor` narrows it. */
  color: string | null;
};

/**
 * Columns a peer may never read (telemetry, health, the identity snapshot) and their parallel DTO
 * fields; everything else on the row is peer-visible. The peer projection must never carry one —
 * `session-visibility.test.ts` asserts it as a property, so add a new operator-only column here first.
 */
export const OPERATOR_ONLY_SESSION_COLUMNS = [
  "tool_label",
  "model",
  "context_used",
  "context_window",
  "tokens_spent",
  "started_at",
  "last_activity_at",
  "identity_name",
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
  "identityName",
  "turns",
  "tokensDelta",
  "stale",
  "deniedCalls",
  "lastDeniedTool",
  "lastWakeSeq",
  "lastWakeAt",
] as const;

/**
 * One reported row, in column names. `user_id` / `workspace_id` are absent on purpose: the repository
 * stamps them from the authenticated context, never from the caller's payload.
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
  turns: number | null;
  tokens_delta: number | null;
  stale: boolean | null;
  denied_calls: number | null;
  last_denied_tool: string | null;
  last_wake_seq: number | null;
  last_wake_at: string | null;
  display_name: string | null;
  /** A snapshot the desktop reports; the server never resolves an identity here. */
  identity_name: string | null;
  /** The one field the server may overrule (`session-colors.ts › resolveReportedColors`). */
  color: AgentColorKey | null;
};

/**
 * The six keys `detail` may render as — a membership test, not a cast: `detail` is peer-visible only
 * because it is closed, so anything else (free-form text) becomes `null` before it can reach a peer.
 */
const SESSION_DETAIL_KEYS: ReadonlySet<string> = new Set<SessionDetailKey>([
  "thinking",
  "tool",
  "posting",
  "permission",
  "awaiting_peer",
  "awaiting_inbound",
]);

/** Narrowed, never cast: an unknown key would be an empty `var()` and an invisible border. */
export function narrowSessionColor(
  value: string | null | undefined
): AgentColorKey | null {
  return agentColorOrNull(value);
}

export function narrowSessionDetail(
  value: string | null | undefined
): SessionDetailKey | null {
  if (typeof value !== "string") return null;
  return SESSION_DETAIL_KEYS.has(value) ? (value as SessionDetailKey) : null;
}

/** A BIGINT off PostgREST as a number; `null` and unparseable values stay `null`, never 0. */
function bigintOrNull(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The peer projection, and the fence: it builds a narrow object (fails closed when a column is added)
 * because every read runs on the RLS-bypassing admin client. Two mappers, no default audience.
 */
export function mapPeerSessionStateRow(
  row: SessionStateRow
): ChannelSessionState {
  return {
    channelId: row.channel_id,
    threadId: row.task_id,
    name: row.name,
    // A cast, not a check: the render's closed-set test (`channel-session-render.ts › formatSessionLine`) holds.
    state: row.state as SessionPillState,
    // Narrowed, never passed through: a free-form value must not reach a peer.
    detail: narrowSessionDetail(row.detail),
    channelName: row.channel_name,
    threadTitle: row.thread_title,
    // Peer-visible by design; bounded at the schema and the column CHECK.
    displayName: row.display_name ?? null,
    // Peer-visible, and narrowed rather than passed through.
    color: narrowSessionColor(row.color),
    updatedAt: row.updated_at,
  };
}

/** The owner projection, telemetry included — only for reads fenced on `ctx.userId`. */
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
    // Only this mapper may name it: a peer would learn a private identity exists (404-not-403 rule).
    identityName: row.identity_name,
    // `bigintOrNull` on the INT4s too: what matters there is `null` surviving as `null`.
    turns: bigintOrNull(row.turns),
    tokensDelta: bigintOrNull(row.tokens_delta),
    // Not defaulted to `false`: NULL means nothing evaluated it, not "not wedged".
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

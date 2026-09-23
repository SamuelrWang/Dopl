import "server-only";
import {
  normalizeUnaddressedResponder,
  resolveDefaultResponder,
  UNADDRESSED_RESPONDER_DEFAULT,
  type ResponderChoice,
  type UnaddressedResponderSetting,
} from "../lib/agent-mentions";
import { recentAgentsAddressedBy } from "../lib/agent-post-stamp";
import type { SessionStateRow } from "./collab-dto";
import * as repoMessages from "./repository-messages";
import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
import type { ChannelContext } from "./service-shared";

/**
 * The wake verdict's resilience rules; `service-wake-verdict.ts` is the entry point and only
 * caller. The fan-out narrows to the addressed recipient, so a forgotten `@` must be repaired here,
 * server-side, so every desktop gets the same rule. The arms are disjoint by (in a thread?) ×
 * (author kind): exactly one fires and none is a fallback for another. RR2 (`reciprocalParty`) is
 * retired; its `reciprocal` verdict is a tombstone in `types-delivery.ts › ChannelWakeVerdict`.
 */

/**
 * Every live agent in this room, whoever runs it: RR3's candidates and the list a `delivery=none`
 * reports. Channel-wide is safe only because every caller is gated on a PERSON authoring the post;
 * that gate lives at each call site, never here (agent authors stay own-scoped).
 * Liveness is presence: the push is a full-set replace that omits ended sessions. Never filter on
 * `updated_at` — it is not a heartbeat, and a filtered row would read stale as absent.
 * A nameless row is dropped: `name` is the agent id every door addresses.
 */
export async function liveChannelSessions(
  ctx: ChannelContext,
  channelId: string
): Promise<SessionStateRow[]> {
  const rows = await repoSessions.listChannelSessionStates(
    ctx.workspaceId,
    channelId
  );
  return rows.filter((row) => row.name.length > 0);
}

/**
 * RR1: a thread reply with no `to` goes to the thread's other party. Total because a thread has
 * exactly two parties (`isThreadParticipant` 403s a third first). Reads the stamps
 * `resolvePostMetadata` already re-derived from the thread row, so no round trip. A legacy
 * `task-<channelId>-<seq>` tag or an unaddressed thread resolves to `null`: the send keeps the
 * `thread` verdict and wakes nothing.
 */
export function threadOtherParty(
  ctx: ChannelContext,
  metadata: Record<string, unknown>
): string | null {
  const createdBy =
    typeof metadata.taskCreatedBy === "string" ? metadata.taskCreatedBy : null;
  const target =
    typeof metadata.taskTarget === "string" ? metadata.taskTarget : null;
  if (createdBy === null) return null;
  if (ctx.userId === createdBy) return target;
  if (ctx.userId === target) return createdBy;
  return null;
}

/**
 * RR3: an unaddressed human message is answered by at most one agent. The row-shaped adapter over
 * `lib/agent-mentions.ts › resolveDefaultResponder`, which lives there so the composer can predict
 * the same answer. An empty room answers nobody and is not a refusal: nothing was mis-addressed
 * (`CHANNEL_RECIPIENT_UNRESOLVED` is for a `to` naming someone absent).
 */
export async function defaultResponder(
  /** The author's own `channel_members.unaddressed_responder`, coerced by the caller: "could not
   *  read it" must never arrive here as `"none"`. */
  setting: UnaddressedResponderSetting,
  sessions: readonly SessionStateRow[],
  /** A thunk: the recency read is this arm's whole cost, so it runs only when needed. */
  recent: () => Promise<string[]>
): Promise<ResponderChoice | null> {
  // `"none"` first: an opted-out member never pays for the sort or the read.
  if (setting === "none") return null;
  const candidates = launchOrder(sessions).map((row) => ({
    agentId: row.name,
    displayName: row.display_name,
  }));
  // No live agent: nobody, without paying for the read.
  if (candidates.length === 0) return null;
  const settled = resolveDefaultResponder(setting, candidates);
  // Only `only agent` skips the read (F-705). A `null` here is an answer ("nobody"), not "no
  // opinion": with several live agents it is the no-recency answer, and returning it would skip
  // the asker's last-tagged live agent.
  if (settled !== null && settled.reason === "only agent") return settled;
  return resolveDefaultResponder(setting, candidates, await recent());
}

/**
 * The asking member's own "unaddressed messages" setting: one keyed lookup on
 * `(channel_id, user_id)`. Fails to the default, never to `"none"`: a missing row or a read error
 * must not silently stop answering a member who never chose that. `normalizeUnaddressedResponder`
 * owns the coercion; do not add a second.
 */
export async function unaddressedResponderFor(
  channelId: string,
  userId: string
): Promise<UnaddressedResponderSetting> {
  try {
    return normalizeUnaddressedResponder(
      await repo.findUnaddressedResponder(channelId, userId)
    );
  } catch {
    // Swallowed here only: the post is already written, and a failed settings read must degrade
    // to the default rather than lose the message.
    return UNADDRESSED_RESPONDER_DEFAULT;
  }
}

/**
 * Live sessions, most recently launched first (`started_at`, else the row's first push,
 * `created_at`). An unparseable or absent pair sorts last.
 */
function launchOrder(
  sessions: readonly SessionStateRow[]
): readonly SessionStateRow[] {
  const at = (row: SessionStateRow): number => {
    const parsed = Date.parse(row.started_at ?? row.created_at ?? "");
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  return [...sessions].sort((a, b) => at(b) - at(a));
}

/**
 * The agents THIS author addressed in this room, most recent first, with no time window: the one
 * you last tagged stays your default until you tag another live agent or it ends. The only bound
 * is the read's page of the author's own room posts, enough because the walk stops at the first
 * live id. The rule is `lib/agent-post-stamp.ts › recentAgentsAddressedBy`, shared with the
 * composer so its recipient line and the stored verdict cannot disagree. The walk does not filter
 * for liveness; the resolver intersects it with the live candidates.
 */
export async function recentRoomAgents(
  channelId: string,
  /** The routed message's own author. */
  authorUserId: string,
  now: number
): Promise<string[]> {
  const rows = await repoMessages.listRecentRoomTagsBy(channelId, authorUserId);
  return recentAgentsAddressedBy(
    authorUserId,
    rows.map((row) => ({
      seq: Number(row.seq),
      createdAt: row.created_at,
      authorUserId: row.author_user_id,
      // Carried so the rule itself drops this author's own agents (F-704); the SQL excludes them
      // too, but the predicate is the enforcement.
      authorKind: row.author_kind,
      recipientAgentIds: row.recipient_agent_ids ?? null,
      metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    })),
    // No `windowMs`; `now` is still passed so the walk stays a pure function of the write's clock.
    { now }
  );
}

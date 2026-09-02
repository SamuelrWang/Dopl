import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import { AGENT_DIRECTION_TTL_MS, PRESENCE_ONLINE_WINDOW_MS } from "../constants";
import type { AgentDirection, DirectionRefusalReason } from "../types-direction";
import type { DirectionCreateInput } from "../schema-direction";
import {
  DirectionNotClaimableError,
  DirectionNotFoundError,
} from "./errors";
import * as directionRepo from "./repository-directions";
import type { AgentDirectionRow } from "./repository-directions";
import * as collab from "./repository-collab";
import * as repoTasks from "./repository-tasks";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";
// ⚠ THE RACE HALF OF G10, SHARED WITH THE LAUNCH LANE — see that module for why
// the PROBE is not in it and this file states its own gate ordering instead.
import { insertOrConverge } from "./service-mailbox-idempotency";

/**
 * THE PRIVATE DIRECT LANE — an operator's external agent steering that operator's
 * OWN running agent session (Samuel's ruling, 2026-08-31).
 *
 * ⚠ **THE SERVER DELIVERS NOTHING AND CANNOT.** Agents live in a desktop main
 * process no server can reach; this file writes a MAILBOX row that the operator's
 * own machine claims. Everything below is the launch lane's shape with three
 * differences that matter, each of them a ruling rather than an accident:
 *
 *   1. **`agentId` IS REQUIRED AND HAS NO FALLBACK.** Every other op in the family
 *      resolves to the oldest live agent on a thread when none is named; for a
 *      lane that reaches a PRIVATE TURN that would steer a different agent than
 *      the orchestrator addressed, with nothing reporting the swap.
 *   2. **THE TTL IS LONGER** (`AGENT_DIRECTION_TTL_MS`), because a direction is
 *      answered by a TURN rather than by a process start.
 *   3. 🔒 **THE DECIDE CARRIES `reply`** — the directed turn's final text, and the
 *      one place private-lane text leaves a machine. The rule governing it is
 *      stated on `types-direction.ts › AgentDirection.reply` and may not be
 *      generalised.
 *
 * 🔒 **`operator_user_id` IS `ctx.userId` AND IS NEVER A PARAMETER.** No schema in
 * `schema-direction.ts` has such a field and none may ever get one. That absence is
 * the whole authorization story: the only machine an agent may direct is its own
 * operator's, and there is no spelling of this API that says otherwise.
 */

/** ⚠ The closed set, restated here as the SERVICE's copy for the same reason
 *  `LAUNCH_REFUSAL_REASONS` is: the column CHECK, the zod enum and this array are
 *  three statements of one contract, and `closedEnum` binds two of them. */
export const DIRECTION_REFUSAL_REASONS = [
  "no-session",
  "auth-hold",
  "busy",
  "blocked",
  "no-bridge",
] as const;

function isTerminal(status: string): boolean {
  return status === "delivered" || status === "refused" || status === "expired";
}

/**
 * Row → DTO, WITH LAZY EXPIRY APPLIED.
 *
 * ⚠ THE REPORTED STATUS MAY DIFFER FROM THE STORED COLUMN, by design: expiry is
 * lazy and there is no cron, so a non-terminal row past `expires_at` REPORTS as
 * `expired` while the column still says `pending`. The claim CAS is what makes
 * that safe — a row can only leave `pending` once, whatever this says.
 */
function toDirection(row: AgentDirectionRow, now: number): AgentDirection {
  const expired = !isTerminal(row.status) && now > Date.parse(row.expires_at);
  return {
    id: row.id,
    operatorUserId: row.operator_user_id,
    channelId: row.channel_id,
    threadId: row.task_id,
    agentId: row.agent_id,
    // ⚠ A LABEL, UNVERIFIED, and `?? null` because a desktop or a row older than
    // the column simply has none — absent means UNKNOWN, never "the operator".
    senderAgentId: row.sender_agent_id ?? null,
    body: row.body,
    status: expired
      ? "expired"
      : (row.status as AgentDirection["status"]),
    refusalReason: (row.refusal_reason as DirectionRefusalReason | null) ?? null,
    reply: row.reply,
    claimedAt: row.claimed_at,
    decidedAt: row.decided_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * 🔒 WHICH OF THE OPERATOR'S OWN AGENTS FILED THIS — **AN UNVERIFIED LABEL, AND
 * THE ONLY HONEST ONE AVAILABLE** (F-376a, 2026-08-31).
 *
 * ⚠ **READ THIS BEFORE USING THE VALUE FOR ANYTHING.** The input is
 * `X-Dopl-Session-Id`, the desktop's slot key `<channelId>:<taskId>:<agentId>`,
 * and INVARIANTS §10 already records what that header is worth: *a routing hint,
 * not authorization — anything holding this device token can set it, so it PROVES
 * nothing about the caller. Nothing may be GRANTED on it.* This function does not
 * change that and cannot. What comes out is a CAPTION for the operator's own
 * panel; **nothing may gate, route, filter or authorize on it.**
 *
 * ⚠ WHY IT IS STILL WORTH STAMPING. Samuel's same-owner ruling makes the
 * operator's own desktop sessions first-class `direct_agent` callers, so a room
 * can hold six of their agents directing each other and "your agent said this"
 * stops being a complete sentence. The alternatives were: a new REQUEST FIELD
 * (rejected — no schema on this path accepts an identity, and adding the first
 * one would be strictly worse, since a payload field is forgeable by exactly the
 * same party AND breaks the rule that makes the fence easy to verify), or nothing
 * at all. A server-derived caption that says it is a caption is the honest middle.
 *
 * ⚠ AND THE BLAST RADIUS IS ZERO BY CONSTRUCTION: the row is owner-only in SQL,
 * in RLS and in every repository predicate, so the only party who could forge
 * this value is the operator's own side, and the only party who can read it is
 * the same operator. A forged sender mislabels one line on the forger's own
 * screen.
 *
 * Returns `null` for anything that is not exactly an agent id — an unstamped
 * external orchestrator, a malformed header, a segment of the wrong shape. ⚠ The
 * charset is the column's CHECK and `main/agent-id.js › AGENT_ID_RE`; a value
 * that fails it is DROPPED rather than stored, so a forged header cannot park
 * free text in a column a renderer prints.
 */
const SENDER_AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;

export function senderAgentIdFrom(sessionId: string | null | undefined): string | null {
  if (typeof sessionId !== "string" || sessionId === "") return null;
  // ⚠ THE LAST SEGMENT, and it is read by SPLITTING rather than by a regex over
  // the whole key: the key's internal shape is main's, not this tree's, and the
  // desktop's own rule is that the key is COMPARED, never split
  // (`session-store.js › threadKeyPrefix`). Reading only the tail keeps this
  // ignorant of the first two segments, so a future key shape breaks the caption
  // and nothing else.
  const parts = sessionId.split(":");
  if (parts.length < 3) return null;
  const tail = parts[parts.length - 1];
  return SENDER_AGENT_ID_RE.test(tail) ? tail : null;
}

/**
 * IS THE OPERATOR'S MACHINE REPORTING IN? The pre-check that keeps a row from
 * being filed for a machine nobody is running.
 *
 * ⚠ IT IS A HINT, NOT A VERDICT, and the op's copy says so. `agent_presence` is
 * per-(user, workspace), so it cannot say WHICH machine is up, whether the one
 * holding the named agent is up, or whether the direction toggle is even on there.
 * ⚠ IT REUSES `PRESENCE_ONLINE_WINDOW_MS` rather than minting a second liveness
 * number, so the roster and this path cannot disagree.
 */
async function operatorIsOnline(ctx: ChannelContext): Promise<boolean> {
  const presence = await collab.presenceForWorkspace(ctx.workspaceId);
  const mine = presence.get(ctx.userId);
  const seenAt = mine?.lastSeenAt ? Date.parse(mine.lastSeenAt) : NaN;
  if (Number.isNaN(seenAt)) return false;
  return Date.now() - seenAt < PRESENCE_ONLINE_WINDOW_MS;
}

/**
 * ⚠ **`existing: true` MEANS THE ROW WAS ALREADY THERE — this call filed
 * NOTHING** (2026-09-02, A10/G10). The caller re-sent a `clientMsgId` it had used
 * before and got the FIRST request's direction back, `reply` included if the
 * machine has answered by now. That is what makes a timed-out direction
 * RETRYABLE: without the key, asking again says the same thing to a live agent
 * twice and it answers twice, with no way for either side to tell which answer
 * belonged to which.
 */
export type CreateDirectionResult =
  | { offline: true; direction: null }
  | { offline: false; direction: AgentDirection; existing: boolean };

/**
 * FILE A DIRECTION.
 *
 * Gate order, and it is chosen so nothing is filed against a channel the caller
 * cannot reach:
 *  1. **MEMBERSHIP, not readability.** `loadVisibleChannel` admits a non-member to
 *     a PUBLIC channel; a direction may only be filed by a member, because it
 *     reaches an agent working that channel. A non-member gets the 404.
 *  2. The thread, when one is named, must be in that channel.
 *  3. Presence — and if the machine is not reporting in, NOTHING IS FILED and the
 *     result says so, rather than leaving a row to expire unseen.
 *
 * ⚠ **THE AGENT ID IS NOT VALIDATED HERE AND CANNOT BE.** Whether an agent is
 * alive is knowable only on the machine running it; the server has no registry to
 * check against (`channel_sessions` is a PROJECTION the desktop pushes, so a quiet
 * row means nobody said anything, not that nothing is running). A wrong id is
 * answered `no-session` by the desktop, which is the only authoritative source.
 */
export async function createAgentDirection(
  ctx: ChannelContext,
  input: DirectionCreateInput
): Promise<CreateDirectionResult> {
  const { channel, membership } = await loadVisibleChannel(ctx, input.channel);
  if (membership === null) throw new DirectionNotFoundError(input.channel);

  // ⚠ **THE IDEMPOTENCY PROBE SITS ABOVE THE THREAD AND PRESENCE GATES, AND THE
  // POSITION IS THE CONTRACT** (2026-09-02, A10/G10) — the launch lane's ordering
  // for the launch lane's reasons, plus the one that is this lane's own: the
  // stored row may already carry the REPLY, so a converged retry is how a caller
  // whose hold timed out collects the answer it was waiting for. Running the
  // presence gate first would answer `offline` — "nothing was filed" — about a
  // direction that IS filed and may already have been delivered.
  // ⚠ BELOW membership, always: converging on a stored row is still a read of a
  // channel the caller must be in.
  if (input.clientMsgId) {
    const stored = await directionRepo.findAgentDirectionByClientMsgId(
      ctx.userId,
      channel.id,
      input.clientMsgId
    );
    if (stored) {
      return { offline: false, direction: toDirection(stored, Date.now()), existing: true };
    }
  }

  if (input.threadId) {
    const task = await repoTasks.findTaskByChannelAndId(
      channel.id,
      input.threadId
    );
    if (!task) throw new DirectionNotFoundError(input.threadId);
  }

  // ⚠ NOTHING IS FILED FOR A MACHINE THAT IS NOT REPORTING IN. A row nobody will
  // ever claim expires silently and tells the orchestrator nothing it can act on.
  if (!(await operatorIsOnline(ctx))) return { offline: true, direction: null };

  const now = Date.now();
  // ⚠ THE RACE HALF OF G10 — two retries arriving together, where both probes
  // missed and the partial unique index refuses the second insert.
  const { row, existing } = await insertOrConverge({
    clientMsgId: input.clientMsgId,
    find: (key) =>
      directionRepo.findAgentDirectionByClientMsgId(ctx.userId, channel.id, key),
    insert: () => directionRepo.insertAgentDirection(ctx.userId, {
      workspace_id: ctx.workspaceId,
      channel_id: channel.id,
      task_id: input.threadId ?? null,
      agent_id: input.agentId,
      // ⚠ STAMPED FROM THE TRANSPORT, NEVER FROM THE PAYLOAD (F-376a). See
      // `senderAgentIdFrom` for what it is worth and what it must never be used
      // for.
      sender_agent_id: senderAgentIdFrom(ctx.sessionId),
      body: input.body,
      expires_at: new Date(now + AGENT_DIRECTION_TTL_MS).toISOString(),
      client_msg_id: input.clientMsgId ?? null,
    }),
  });
  return { offline: false, direction: toDirection(row, now), existing };
}

/** THE DESKTOP'S BACKSTOP READ. ⚠ Expired rows are dropped HERE, in TS, not in
 *  SQL — one expiry rule, and it lives at the read. */
export async function listPendingAgentDirections(
  ctx: ChannelContext
): Promise<AgentDirection[]> {
  const rows = await directionRepo.listPendingAgentDirections(
    ctx.userId,
    ctx.workspaceId
  );
  const now = Date.now();
  return rows
    .map((row) => toDirection(row, now))
    .filter((d) => d.status !== "expired");
}

/**
 * THE ORCHESTRATOR'S OWN RECENT DIRECTIONS — what `op="read_directions"` renders.
 *
 * ⚠ TERMINAL ROWS ARE KEPT, unlike the backstop read's: the `reply` is the whole
 * reason this op exists, and a read that dropped answered rows would answer "you
 * asked nothing" the moment a direction succeeded.
 */
export async function listRecentAgentDirections(
  ctx: ChannelContext,
  filter: { channelId?: string; agentId?: string } = {}
): Promise<AgentDirection[]> {
  // ⚠ A NON-UUID `channelId` IS DROPPED, NOT PASSED THROUGH (adversarial review, 2026-08-31).
  // It would reach Postgres as a 22P02 on a `uuid =` filter — a 500 per call — where the route's
  // own docblock promised "the worst a junk value achieves is an empty list". ⚠ DROPPING the
  // filter rather than refusing the call is right here BECAUSE THE FENCE IS ELSEWHERE: the
  // operator predicate still applies, so a junk narrowing widens nothing.
  const rows = await directionRepo.listRecentAgentDirections(
    ctx.userId,
    ctx.workspaceId,
    { ...filter, channelId: isUuid(filter.channelId ?? "") ? filter.channelId : undefined }
  );
  const now = Date.now();
  return rows.map((row) => toDirection(row, now));
}

export async function getAgentDirection(
  ctx: ChannelContext,
  id: string
): Promise<AgentDirection> {
  // ⚠ THE SHAPE CHECK IS NOT COSMETIC (adversarial review, 2026-08-31), and it is
  // `requireConsentId`'s rationale exactly: `id` goes straight into a `uuid =` filter, so a
  // non-UUID reaches Postgres as a 22P02 cast failure — a 500 plus a `system_events` row on
  // EVERY such call. ⚠ Malformed collapses to the SAME 404 a missing or foreign id gets, so the
  // three stay indistinguishable and ids cannot be probed.
  if (!isUuid(id)) throw new DirectionNotFoundError(id);
  const row = await directionRepo.findAgentDirection(
    ctx.userId,
    ctx.workspaceId,
    id
  );
  if (!row) throw new DirectionNotFoundError(id);
  return toDirection(row, Date.now());
}

/**
 * CLAIM ONE, for the machine that asked.
 *
 * ⚠ THE PRE-READ EXISTS TO TELL THE THREE FAILURES APART. The CAS alone answers
 * `null` for "already decided", "too late" and "lost the race" alike, and the
 * desktop's diag line is the only place an operator can see which — so the
 * distinguishable ones are distinguished before the CAS runs, and `null` from the
 * CAS itself can then only mean the race.
 */
export async function claimAgentDirection(
  ctx: ChannelContext,
  id: string
): Promise<AgentDirection> {
  if (!isUuid(id)) throw new DirectionNotFoundError(id);
  const existing = await directionRepo.findAgentDirection(
    ctx.userId,
    ctx.workspaceId,
    id
  );
  if (!existing) throw new DirectionNotFoundError(id);
  if (isTerminal(existing.status)) {
    throw new DirectionNotClaimableError("decided");
  }
  if (Date.now() > Date.parse(existing.expires_at)) {
    throw new DirectionNotClaimableError("expired");
  }
  const claimed = await directionRepo.claimAgentDirection(
    ctx.userId,
    ctx.workspaceId,
    id,
    new Date().toISOString()
  );
  if (!claimed) throw new DirectionNotClaimableError("taken");
  return toDirection(claimed, Date.now());
}

export type DecideDirectionInput =
  | { status: "delivered"; reply?: string }
  | { status: "refused"; refusalReason: DirectionRefusalReason };

/**
 * WRITE THE TERMINAL OUTCOME.
 *
 * ⚠ AN EXPIRED DIRECTION MAY STILL BE DECIDED — there is deliberately no expiry
 * check on this path. A machine that did the work and is now reporting must be
 * able to, and the alternative is an orchestrator told "expired" about a turn that
 * really ran. The launch lane makes the same call for the same reason.
 *
 * 🔒 **`reply` IS BOUNDED BY THE SCHEMA AND BY THE COLUMN, AND CHARSET-STRIPPED ON
 * THE DESKTOP BEFORE IT IS SENT.** Neither bound may be relaxed here: the entire
 * justification for the column is that it carries exactly one turn's final text.
 * ⚠ An absent `reply` on a `delivered` writes `null`, which means NOT REPORTED —
 * never "the agent said nothing". The render must say which it cannot tell.
 */
export async function decideAgentDirection(
  ctx: ChannelContext,
  id: string,
  input: DecideDirectionInput
): Promise<AgentDirection> {
  const decided = await directionRepo.decideAgentDirection(
    ctx.userId,
    ctx.workspaceId,
    id,
    {
      status: input.status,
      refusal_reason:
        input.status === "refused" ? input.refusalReason : null,
      reply: input.status === "delivered" ? (input.reply ?? null) : null,
      decided_at: new Date().toISOString(),
    }
  );
  if (decided) return toDirection(decided, Date.now());
  // ⚠ The CAS answered nothing: re-read to tell "no such row" from "already
  // decided", exactly as the claim path does, so the desktop's log is honest.
  const existing = await directionRepo.findAgentDirection(
    ctx.userId,
    ctx.workspaceId,
    id
  );
  if (!existing) throw new DirectionNotFoundError(id);
  throw new DirectionNotClaimableError("decided");
}

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

export type CreateDirectionResult =
  | { offline: true; direction: null }
  | { offline: false; direction: AgentDirection };

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
  const row = await directionRepo.insertAgentDirection(ctx.userId, {
    workspace_id: ctx.workspaceId,
    channel_id: channel.id,
    task_id: input.threadId ?? null,
    agent_id: input.agentId,
    body: input.body,
    expires_at: new Date(now + AGENT_DIRECTION_TTL_MS).toISOString(),
  });
  return { offline: false, direction: toDirection(row, now) };
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

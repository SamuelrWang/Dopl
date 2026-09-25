import "server-only";
import { LAUNCH_DIRECTIVE_TTL_MS } from "../constants";
import type {
  AgentColorKey,
  LaunchDirective,
  LaunchMessageMode,
  LaunchRefusalReason,
  LaunchToolMode,
} from "../types";
import {
  LaunchDirectiveNotClaimableError,
  LaunchDirectiveNotFoundError,
} from "./errors";
import { resolveDirectiveColor } from "./service-launch-color";
import * as launchRepo from "./repository-launch";
import * as repoTasks from "./repository-tasks";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";
import { insertOrConverge } from "./service-mailbox-idempotency";
import { resolveIdentityForDirective } from "./service-launch-identity";
import { isTerminal, toDirective } from "./service-launch-dto";
export { toDirective } from "./service-launch-dto";

/** Launch-directive lifecycle: an operator's own agent asks that operator's own desktop to start an
 *  agent. The server starts nothing; it files a request and reports what the machine said it did. */

import { operatorIsOnline } from "./service-launch-presence";
export { operatorIsOnline };

export type CreateLaunchInput = {
  /** Slug or id. */
  channel: string;
  /** Must belong to `channel`. */
  threadId?: string;
  goal?: string;
  model?: string;
  /** Carried verbatim, never inferred from `model`; the operator's machine resolves it and
   *  refuses one it cannot start (`no-sdk`). */
  runtime?: string;
  /** An id or exact name; {@link resolveIdentityForDirective} resolves it for this caller. */
  identity?: string;
  /** The posture this launch asks for. The operator's machine clamps it
   *  (`main/launch-posture.js › resolveLaunch`): narrower sticks, never wider than the channel. */
  tools?: LaunchToolMode;
  messages?: LaunchMessageMode;
  chain?: boolean;
  /** Idempotency key: a resend returns the stored directive (`existing: true`), never a second agent. */
  clientMsgId?: string;
  /** Omitted = first free colour, never "no colour"; a taken key is a 409 with the free set. */
  color?: AgentColorKey;
  agentName?: string; // required by `LaunchCreateSchema`; a nameless row is named `New Agent` by the claiming machine
};

/** `offline`: no row was created. `existing: true`: a resent `clientMsgId` returned the first
 *  request's directive and this call filed nothing. */
export type CreateLaunchResult =
  | { offline: true; directive: null }
  | { offline: false; directive: LaunchDirective; existing: boolean };

/** File a launch directive. Gates, in order: membership → idempotency probe → thread in channel →
 *  identity → colour → presence (`offline`, nothing filed). Identity and colour sit above presence:
 *  a bad ref is the caller's error, answerable without anyone's machine.
 *  `operator_user_id` is always `ctx.userId`; no function on this path accepts an operator. */
export async function createLaunchDirective(
  ctx: ChannelContext,
  input: CreateLaunchInput
): Promise<CreateLaunchResult> {
  const { channel, membership } = await loadVisibleChannel(ctx, input.channel);
  if (membership === null) {
    // Membership, not just visibility (`loadVisibleChannel` admits non-members to public channels);
    // not-found shaped so a non-member learns nothing new about the room.
    throw new LaunchDirectiveNotFoundError(input.channel);
  }

  // Below membership, above thread/identity/presence: a filed key is this request's answer, and
  // re-deciding it against today's world could refuse or `offline` a launch that already happened.
  if (input.clientMsgId) {
    const stored = await launchRepo.findLaunchDirectiveByClientMsgId(
      ctx.userId,
      channel.id,
      input.clientMsgId
    );
    if (stored) {
      return { offline: false, directive: toDirective(stored, Date.now()), existing: true };
    }
  }

  let taskId: string | null = null;
  if (input.threadId) {
    const task = await repoTasks.findTaskByChannelAndId(
      channel.id,
      input.threadId
    );
    // Same not-found as a foreign id, so thread ids can't be probed across channels.
    if (!task) throw new LaunchDirectiveNotFoundError(input.threadId);
    taskId = task.id;
  }

  const identity = await resolveIdentityForDirective(ctx, input.identity);

  const color = await resolveDirectiveColor(ctx, channel.id, input.color);

  if (!(await operatorIsOnline(ctx))) {
    return { offline: true, directive: null };
  }

  const now = Date.now();
  // The race half: two concurrent retries both miss the probe and the unique index refuses the
  // second insert (`service-mailbox-idempotency.ts`).
  const { row, existing } = await insertOrConverge({
    clientMsgId: input.clientMsgId,
    find: (key) =>
      launchRepo.findLaunchDirectiveByClientMsgId(ctx.userId, channel.id, key),
    insert: () => launchRepo.insertLaunchDirective(ctx.userId, {
      workspace_id: ctx.workspaceId,
      channel_id: channel.id,
      task_id: taskId,
      goal: input.goal ?? null,
      model: input.model ?? null,
      runtime: input.runtime ?? null,
      // `identity_name` is a snapshot that survives the FK's ON DELETE SET NULL, so a deleted
      // identity stays distinguishable from none.
      identity_id: identity?.id ?? null,
      identity_name: identity?.name ?? null,
      // The asked posture, verbatim; `null` = not asked. `chain` uses `?? null`, not `||`, so a
      // sent `false` is recorded.
      start_tool_mode: input.tools ?? null,
      start_message_mode: input.messages ?? null,
      chain: input.chain ?? null,
      // The server clamps nothing and resolves no model; the machine's `applied_*` is the truth.
      resolved_tool_mode: null,
      resolved_message_mode: null,
      resolved_chain: null,
      resolved_model: null,
      color,
      agent_name: input.agentName ?? null, // verbatim; `agent-names.js › sanitizeName` decides what the machine stores
      expires_at: new Date(now + LAUNCH_DIRECTIVE_TTL_MS).toISOString(),
      client_msg_id: input.clientMsgId ?? null,
    }),
  });
  return { offline: false, directive: toDirective(row, now), existing };
}

/** This operator's `pending` and `claimed` directives: the desktop's breaker-open backstop (F-273).
 *  Expiry is filtered here, not in SQL, so {@link toDirective} stays the one expiry rule. `claimed`
 *  rows are included so a machine that crashed before deciding finds its own row. */
export async function listPendingLaunchDirectives(
  ctx: ChannelContext
): Promise<LaunchDirective[]> {
  const now = Date.now();
  const rows = await launchRepo.listPendingLaunchDirectives(
    ctx.userId,
    ctx.workspaceId
  );
  return rows
    .map((row) => toDirective(row, now))
    .filter((d) => d.status !== "expired");
}

/** One directive, expiry applied; own-scoped in the repository. */
export async function getLaunchDirective(
  ctx: ChannelContext,
  id: string
): Promise<LaunchDirective> {
  const row = await launchRepo.findLaunchDirective(
    ctx.userId,
    ctx.workspaceId,
    id
  );
  if (!row) throw new LaunchDirectiveNotFoundError(id);
  return toDirective(row, Date.now());
}

/** Desktop lane: claim, `pending → claimed`, single winner. Freshness is checked here and atomicity
 *  lives in the CAS, so a lost race (`taken`) and a timeout (`expired`) stay distinguishable. Every
 *  failure is a 409: stand down, do not retry. */
export async function claimLaunchDirective(
  ctx: ChannelContext,
  id: string
): Promise<LaunchDirective> {
  const now = Date.now();
  const existing = await launchRepo.findLaunchDirective(
    ctx.userId,
    ctx.workspaceId,
    id
  );
  if (!existing) throw new LaunchDirectiveNotFoundError(id);
  if (isTerminal(existing.status)) {
    throw new LaunchDirectiveNotClaimableError("decided");
  }
  if (now > Date.parse(existing.expires_at)) {
    throw new LaunchDirectiveNotClaimableError("expired");
  }

  const row = await launchRepo.claimLaunchDirective(
    ctx.userId,
    ctx.workspaceId,
    id,
    new Date(now).toISOString()
  );
  // `null` here is only the race: the pre-read already ruled out missing, decided and expired.
  if (!row) throw new LaunchDirectiveNotClaimableError("taken");
  return toDirective(row, now);
}

export type DecideLaunchInput =
  /**
   * A launch's success (the column CHECK pairs `launched` with `kind = 'launch'`). The `applied*`
   * echo is optional forever: an older desktop reports none (INVARIANTS §13).
   */
  | {
      status: "launched";
      agentId: string;
      appliedTools?: LaunchToolMode;
      appliedMessages?: LaunchMessageMode;
      appliedChain?: boolean;
      /** The machine's final name; its uniqueness rule may have changed the requested one. */
      appliedAgentName?: string;
      appliedRuntime?: string;
      appliedModel?: string;
      appliedSetting?: string;
    }
  /** Non-launch kinds' success. No agent id: the row already names its target. The optional pair
   *  is `set_agent_mode`'s echo. */
  | { status: "done"; appliedTools?: LaunchToolMode; appliedMessages?: LaunchMessageMode }
  | { status: "refused"; refusalReason: LaunchRefusalReason };

/** Desktop lane: write the terminal outcome. A decision is final: the UPDATE matches only
 *  `pending`/`claimed`, so a retried decide is a 409, never an overwrite. An expired directive may
 *  still be decided: a started agent must be recorded. This is the only writer of `applied_*`;
 *  absent maps to `null` = "not reported", never echoed from the request columns. */
export async function decideLaunchDirective(
  ctx: ChannelContext,
  id: string,
  input: DecideLaunchInput
): Promise<LaunchDirective> {
  const now = Date.now();
  const row = await launchRepo.decideLaunchDirective(
    ctx.userId,
    ctx.workspaceId,
    id,
    {
      status: input.status,
      agent_id: input.status === "launched" ? input.agentId : null,
      refusal_reason:
        input.status === "refused" ? input.refusalReason : null,
      // Posture pair on `launched` and `done`, the rest `launched`-only; every other arm writes
      // `null` so no stale echo stands beside a refusal. `?? null` keeps a reported `false` chain.
      applied_tool_mode:
        input.status !== "refused" ? input.appliedTools ?? null : null,
      applied_message_mode:
        input.status !== "refused" ? input.appliedMessages ?? null : null,
      applied_chain:
        input.status === "launched" ? input.appliedChain ?? null : null,
      applied_agent_name:
        input.status === "launched" ? input.appliedAgentName ?? null : null,
      applied_runtime:
        input.status === "launched" ? input.appliedRuntime ?? null : null,
      applied_model:
        input.status === "launched" ? input.appliedModel ?? null : null,
      applied_setting:
        input.status === "launched" ? input.appliedSetting ?? null : null,
      decided_at: new Date(now).toISOString(),
    }
  );
  if (!row) {
    // "Not yours / gone" vs "already decided": the desktop logs them differently.
    const existing = await launchRepo.findLaunchDirective(
      ctx.userId,
      ctx.workspaceId,
      id
    );
    if (!existing) throw new LaunchDirectiveNotFoundError(id);
    throw new LaunchDirectiveNotClaimableError("decided");
  }
  return toDirective(row, now);
}

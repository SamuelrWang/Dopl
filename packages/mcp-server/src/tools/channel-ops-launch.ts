/**
 * `dopl_channel` op="manage" action="launch" — asks the operator's own desktop to start an agent.
 * This op asks, it starts nothing: a refusal is a normal answer, and a timeout is not a failure
 * (re-issuing without the same `client_msg_id` queues a second agent).
 * A directive is not a message (no `seq`, INVARIANTS §5), so the op holds on the row (`holdRow`).
 * `channel-` filename prefix is required by the parity split-scan (`tool-group-files.ts`).
 */

import type {
  AgentColorKey,
  DoplClient,
  LaunchMessageMode,
  LaunchToolMode,
} from "@dopl/client";
import { ok, err, apiErrorCode, isNotFound, type ToolResponse } from "./respond";
import { LAUNCH_RETRY_ADVICE, holdRow } from "./channel-directive-hold";
import { channelNotFound, isErr, resolveChannelOr } from "./channel-shared";
import { factsLine, postureFacts, runtimeFacts } from "./channel-facts";
import { colorTaken, freeColors } from "./channel-ops-launch-color";
import {
  identityElsewhere,
  identityMatches,
  launchIdentityAmbiguous,
  launchIdentityNotFound,
} from "./channel-ops-launch-identity";
import { IDENTITY_AMBIGUOUS_CODE, IDENTITY_NOT_FOUND_CODE } from "./agent-shared";
import { isNameRefusal, launchName, launchedName } from "./channel-ops-launch-name";
import { isGoalRefusal, launchGoal } from "./channel-ops-launch-goal";
import {
  FIELD_CAPS_NOTE,
  classifyBadRequest,
  isBadRequest,
  serverDetail,
} from "./channel-errors";

/**
 * Ask for an agent, then hold briefly for the answer.
 * Terminal shapes: offline (nothing filed), launched, refused (reason + `retry=`), pending / expired.
 */
export async function opLaunchAgent(
  client: DoplClient,
  ref: string,
  opts: {
    thread?: string;
    goal?: string;
    model?: string;
    /** The runtime (adapter); a separate field from `model`, neither derived from the other. */
    runtime?: string;
    /** Identity id or exact name; disambiguation and visibility are checked server-side. */
    identity?: string;
    /** Asked for, never set: the operator's machine clamps each axis to its own ceiling. */
    tools?: LaunchToolMode;
    messages?: LaunchMessageMode;
    /** Refused (not clamped) when the channel forbids it; omitted is not `false`. */
    chain?: boolean;
    /** Idempotency key: a repeat on `(channel, operator)` returns the stored directive. */
    clientMsgId?: string;
    /** Refused, never substituted, when taken; omitted means first free. */
    color?: AgentColorKey;
    /** Required; optional in the type because it arrives as unvalidated JSON and `launchName` refuses it. */
    name?: string;
    waitMs?: number;
  } = {},
): Promise<ToolResponse> {
  const named = launchName(opts.name);
  if (isNameRefusal(named)) return named;

  // Runs before `resolveChannelOr`: a refusal that needs no round trip must not cost one.
  const goal = launchGoal(opts.goal);
  if (isGoalRefusal(goal)) return goal;

  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;

  let created;
  try {
    created = await client.createLaunchDirective({
      channel: channel.id,
      threadId: opts.thread,
      goal: goal.goal,
      model: opts.model,
      // `runtime` / `identity` / posture / `color` pass through untouched: only the server or the
      // operator's machine can judge them, never this process.
      runtime: opts.runtime,
      identity: opts.identity,
      tools: opts.tools,
      messages: opts.messages,
      chain: opts.chain,
      clientMsgId: opts.clientMsgId,
      color: opts.color,
      agentName: named.name,
    });
  } catch (e) {
    // Discriminate on `code`, not status: two codes share 409 (colour taken, ambiguous identity)
    // and two share 404 (channel, identity).
    if (apiErrorCode(e) === "AGENT_COLOR_TAKEN") {
      return colorTaken(opts.color ?? "", freeColors(e));
    }
    if (apiErrorCode(e) === IDENTITY_AMBIGUOUS_CODE) {
      return launchIdentityAmbiguous(opts.identity ?? "", identityMatches(e));
    }
    if (apiErrorCode(e) === IDENTITY_NOT_FOUND_CODE) {
      return launchIdentityNotFound(opts.identity ?? "", identityElsewhere(e));
    }
    // Any other 400 is classified, and `serverDetail` names the refused field; nothing was filed.
    if (isBadRequest(e) && classifyBadRequest(e) === "invalid_request") {
      return err(
        `No agent was requested — that launch was rejected as INVALID before any directive was filed, and **nothing is pending**. This is NOT a membership, identity or colour problem, so do not invite anyone, re-pick an identity or change \`color\` over it.${serverDetail(e)} ${FIELD_CAPS_NOTE} Fix the field the server named and ask again.`,
      );
    }
    if (isNotFound(e)) return channelNotFound(ref);
    throw e;
  }

  if (created.offline) {
    // Nothing was filed, so nothing is pending. Presence is a per-(user, workspace) hint, not a verdict.
    return ok(factsLine("not launched", { reason: "offline", filed: false, retry: "no" }));
  }

  let directive = created.directive;
  // Spread LAST on every shape so `retry=existing` wins; `existing` is absent on an older server.
  const converged = created.existing ? { retry: "existing" } : {};
  directive = await holdRow(directive, (id) => client.getLaunchDirective(id), opts.waitMs);

  if (directive.status === "launched" && directive.agentId) {
    return ok(
      factsLine("launched", {
        agent: `@agent-${directive.agentId}`,
        // The machine's `appliedAgentName`, never the request: a taken name is stored `-1`.
        name: launchedName(directive.appliedAgentName),
        thread: directive.threadId ?? undefined,
        identity: directive.identityName ?? undefined,
        model: directive.model ?? undefined,
        ...runtimeFacts(directive),
        // `idle=yes` = a stand-by agent running nothing. Read off the directive row, not this call's
        // args: a converged retry returns the first request's row.
        idle: !directive.goal?.trim(),
        ...postureFacts(directive),
        ...converged,
      }),
    );
  }

  if (directive.status === "refused") {
    return ok(
      factsLine("refused", {
        reason: directive.refusalReason ?? undefined,
        // No reason (the column CHECK forbids it) prints `-`, never a guessed verdict.
        retry: directive.refusalReason
          ? LAUNCH_RETRY_ADVICE[directive.refusalReason]
          : undefined,
        filed: true,
        ...converged,
      }),
    );
  }

  if (directive.status === "expired") {
    // No machine ever answered, so asking once more is legitimate (`LAUNCH_RETRY_ADVICE`'s `once`).
    return ok(
      factsLine("expired", {
        directive: directive.id,
        filed: true,
        retry: "once",
        ...converged,
      }),
    );
  }

  // Pending or claimed: `retry=no`, because re-issuing starts a second agent on the same work.
  return ok(
    factsLine("pending", {
      directive: directive.id,
      claimed: directive.status === "claimed",
      expires: directive.expiresAt,
      retry: false,
      ...converged,
    }),
  );
}

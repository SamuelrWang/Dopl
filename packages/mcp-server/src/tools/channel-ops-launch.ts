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
import { channelNotFound, inlineOr, isErr, resolveChannelOr } from "./channel-shared";
import { factsLine, postureFacts, runtimeFacts } from "./channel-facts";
import { colorTaken, freeColors } from "./channel-ops-launch-color";
import {
  IDENTITY_AMBIGUOUS_CODE,
  IDENTITY_NOT_FOUND_CODE,
  identityChoiceLines,
} from "./agent-shared";
// One wording of the tenancy rule, shared with the doctrine.
import { tenancyFix, TENANCY_RULE } from "./channel-doctrine";
import { NO_NAME } from "./narration";
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

// ── The two create-time identity refusals (`AGENT_IDENTITY_AMBIGUOUS`, `AGENT_IDENTITY_NOT_FOUND`) ──

/** One `details.matches` row; each already passed the caller's `canSeeIdentity`, so listing it is not an oracle. */
type IdentityMatch = { id: string; name: string; visibility: string };

export function identityMatches(e: unknown): IdentityMatch[] {
  const details = (e as { details?: unknown } | null)?.details;
  const raw = (details as { matches?: unknown } | null)?.matches;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((m) => ({
      id: typeof m.id === "string" ? m.id : "",
      name: inlineOr(typeof m.name === "string" ? m.name : "", NO_NAME),
      visibility: typeof m.visibility === "string" ? m.visibility : "unknown",
    }))
    .filter((m) => m.id !== "");
}

/**
 * Lists the matches and never picks: identity names are deliberately not unique (a unique index would
 * leak private rows). `err`, because nothing was filed.
 */
export function launchIdentityAmbiguous(ref: string, matches: IdentityMatch[]): ToolResponse {
  const label = inlineOr(ref, NO_NAME);
  if (matches.length === 0) {
    return err(
      `No agent was requested — the identity name \`${label}\` matches MORE THAN ONE identity you can see, and nothing was started. Identity names are deliberately not unique, so this call will not guess between them. List them with the agent-identities surface, then re-issue with the identity's ID instead of its name.`,
    );
  }
  return err(
    [
      `No agent was requested — the identity name \`${label}\` matches ${matches.length} identities you can see, and **nothing was filed**. Identity names are deliberately NOT unique (two members may each keep a "Researcher"), so this call refuses rather than picking one for you.`,
      `Re-issue with the ID of the one you meant:`,
      ...identityChoiceLines(matches),
      `⚠ Every identity listed is one YOU can see. Whether the OPERATOR whose machine runs the agent can see it is a separate question, answered on their machine at start time.`,
    ].join("\n"),
  );
}

/** `details.elsewhere`: an identity the caller holds in another of their own tenancies; duck-typed. */
type IdentityElsewhere = { name: string; label: string };

export function identityElsewhere(e: unknown): IdentityElsewhere | null {
  const details = (e as { details?: unknown } | null)?.details;
  const raw = (details as { elsewhere?: unknown } | null)?.elsewhere;
  if (!raw || typeof raw !== "object") return null;
  const { name, label } = raw as { name?: unknown; label?: unknown };
  if (typeof name !== "string" || typeof label !== "string") return null;
  if (name === "" || label === "") return null;
  return { name, label };
}

/**
 * The caller's own visibility failing at create time (`no-identity` is the operator's, after filing).
 * Never says whether the identity exists (404-never-403). A NAME resolves only in the channel's
 * container, while an ID resolves wherever it lives (`src/features/agent-identities/server/service-resolve-ref.ts ›
 * resolveIdentityRef`); `details.elsewhere` is fenced by `classifyMissingIdentityRef` to identities the caller could already list.
 */
export function launchIdentityNotFound(
  ref: string,
  elsewhere: IdentityElsewhere | null,
): ToolResponse {
  if (elsewhere) {
    return err(
      [
        // `inlineOr` already returns a code span, so no backticks of our own.
        `No agent was requested, and **nothing was filed** — identity ${inlineOr(elsewhere.name, NO_NAME)} lives in ${inlineOr(elsewhere.label, "another tenancy of yours")}, not in this channel's own container.`,
        `⚠ ${TENANCY_RULE} Owning it is not enough; it has to live here. ${tenancyFix()}`,
      ].join("\n"),
    );
  }
  return err(
    [
      // True of a name; the ID case is stated by `TENANCY_RULE`.
      `No agent was requested — no agent identity ${inlineOr(ref, NO_NAME)} resolves in THIS CHANNEL'S container, and **nothing was filed**. Either there is no such identity, or it is not shared with you; those are ONE answer here on purpose, so ids cannot be probed.`,
      `⚠ CHECK THE TENANCY BEFORE THE SPELLING. ${TENANCY_RULE} If it really should resolve here, the NAME is the other suspect — matching is exact, not fuzzy. ${tenancyFix()}`,
    ].join("\n"),
  );
}

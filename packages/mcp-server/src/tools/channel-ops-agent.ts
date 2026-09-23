/**
 * `dopl_channel` op="manage" action="end" / "rename" for the operator's own running agents.
 * Management ops are directives: they ask, the operator's machine answers, and the row is held via `holdRow`.
 * The launch-consent toggle does not gate end/rename, so no copy here may tell a caller to turn it on.
 * The `channel-` filename prefix is load-bearing for the parity scans (`tool-group-files.ts`).
 */

import type {
  DoplClient,
  LaunchDirective,
  LaunchMessageMode,
  LaunchToolMode,
} from "@dopl/client";
import { ok, apiErrorCode, isNotFound, type ToolResponse } from "./respond";
import { LAUNCH_RETRY_ADVICE, holdRow } from "./channel-directive-hold";
import { channelNotFound, isErr, resolveChannelOr } from "./channel-shared";
import { agentDisplayName } from "./agent-display-name";
import {
  agentTarget,
  foreignAgent,
  isAgentTargetRefusal,
} from "./channel-agent-target";
import { factsLine, type FactValue } from "./channel-facts";

/**
 * The three management kinds and their payloads — one declaration shared with `channel-ops-agent-mode.ts`.
 * "At least one axis" for set_agent_mode is checked in `channel-dispatch-agents.ts`, not typed here.
 */
export type AgentDirectiveKind = "end" | "rename" | "set_agent_mode";
export type AgentDirectiveInput =
  | { kind: "end"; channel: string; agentId: string }
  | { kind: "rename"; channel: string; agentId: string; name: string }
  | {
      kind: "set_agent_mode";
      channel: string;
      agentId: string;
      tools?: LaunchToolMode;
      messages?: LaunchMessageMode;
    };

/** Past-tense verb per kind — a map over the kind, never a ternary (F-413). */
const VERB_PAST: Record<AgentDirectiveKind, string> = {
  end: "ended",
  rename: "renamed",
  set_agent_mode: "re-postured",
};

/** The surface that can confirm each kind: only an end shows in `status`; rename and posture live on the operator's machine. */
const PENDING_CONFIRM: Record<AgentDirectiveKind, string> = {
  end: "status",
  rename: "none",
  set_agent_mode: "none",
};

/** Keyed on the kind, never a display word. `retry=no`: a second directive is a second request for the same change. */
export function pendingFacts(
  d: LaunchDirective,
  kind: AgentDirectiveKind,
): Record<string, FactValue> {
  return {
    directive: d.id,
    claimed: d.status === "claimed",
    expires: d.expiresAt,
    retry: false,
    confirm: PENDING_CONFIRM[kind],
  };
}

/**
 * File the directive and hold it (`holdRow`) — plumbing shared with `channel-ops-agent-mode.ts`, which writes its own sentences.
 * A 404 on create is the channel, never the agent.
 */
export async function fileAndHold(
  client: DoplClient,
  ref: string,
  input: AgentDirectiveInput,
  waitMs: number | undefined,
): Promise<
  | { done: true; response: ToolResponse }
  | { done: false; directive: LaunchDirective }
  | { done: true; offline: true; response: ToolResponse }
> {
  let created;
  try {
    created = await client.createAgentDirective(input);
  } catch (e) {
    if (apiErrorCode(e) === "CHANNEL_AGENT_FOREIGN") {
      return {
        done: true,
        response: foreignAgent(input.agentId, VERB_PAST[input.kind]),
      };
    }
    if (isNotFound(e)) return { done: true, response: channelNotFound(ref) };
    throw e;
  }
  if (created.offline) {
    return {
      done: true,
      offline: true,
      // filed=no: nothing was written, so nothing is pending. Presence is a hint, not a verdict.
      response: ok(
        // The verb comes from VERB_PAST, never a ternary (F-413).
        factsLine(`not ${VERB_PAST[input.kind]}`, {
          agent: `@agent-${input.agentId}`,
          reason: "offline",
          filed: false,
        }),
      ),
    };
  }
  return {
    done: false,
    directive: await holdRow(created.directive, (id) => client.getLaunchDirective(id), waitMs),
  };
}

/** End one of the operator's own running agents. A stop verb: no thread or message is touched. */
export async function opEndAgent(
  client: DoplClient,
  ref: string,
  agentId: string,
  opts: { waitMs?: number } = {},
): Promise<ToolResponse> {
  // Target checked before the channel lookup: a refusal needing no round trip must not cost one.
  const target = agentTarget(agentId);
  if (isAgentTargetRefusal(target)) return target;
  const agent = target.agent;

  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;

  const filed = await fileAndHold(
    client,
    ref,
    { kind: "end", channel: channel.id, agentId: agent },
    opts.waitMs,
  );
  if (filed.done) return filed.response;
  const d = filed.directive;

  // handle=spent: instance ids are never reused, so the handle now addresses nobody.
  if (d.status === "done") {
    return ok(
      factsLine("ended", { agent: `@agent-${agent}`, handle: "spent", filed: true }),
    );
  }

  if (d.status === "refused") {
    return ok(
      factsLine("not ended", {
        agent: `@agent-${agent}`,
        reason: d.refusalReason ?? undefined,
        // `-` when the machine named no reason, never a guessed verdict.
        retry: d.refusalReason ? LAUNCH_RETRY_ADVICE[d.refusalReason] : undefined,
        filed: true,
      }),
    );
  }

  if (d.status === "expired") {
    // Lapsed is not refused: nothing is outstanding. Check op="status" before asking again.
    return ok(
      factsLine("not ended", {
        agent: `@agent-${agent}`,
        directive: d.id,
        reason: "expired",
        filed: true,
      }),
    );
  }

  return ok(
    factsLine("pending", { agent: `@agent-${agent}`, ...pendingFacts(d, "end") }),
  );
}

/** Rename one of the operator's own agents: display-only, on one machine; nothing resolves an agent by name. An empty name clears. */
export async function opRenameAgent(
  client: DoplClient,
  ref: string,
  agentId: string,
  name: string,
  opts: { waitMs?: number } = {},
): Promise<ToolResponse> {
  // Same target check as opEndAgent.
  const target = agentTarget(agentId);
  if (isAgentTargetRefusal(target)) return target;
  const agent = target.agent;

  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;
  // A slug is normalized to a display name; the measured string is filed and reported.
  const display = agentDisplayName(name);
  const clearing = display === "";

  const filed = await fileAndHold(
    client,
    ref,
    { kind: "rename", channel: channel.id, agentId: agent, name: display },
    opts.waitMs,
  );
  if (filed.done) return filed.response;
  const d = filed.directive;

  // handle=unchanged: `@agent-<id>` stays the only address. confirm=none: the name never reaches a server.
  if (d.status === "done") {
    return ok(
      factsLine("renamed", {
        agent: `@agent-${agent}`,
        // Cleared falls back to `Agent #<id>`, which is not "unnamed".
        name: clearing ? "cleared" : display,
        handle: "unchanged",
        confirm: "none",
      }),
    );
  }

  if (d.status === "refused") {
    return ok(
      factsLine("not renamed", {
        agent: `@agent-${agent}`,
        reason: d.refusalReason ?? undefined,
        retry: d.refusalReason ? LAUNCH_RETRY_ADVICE[d.refusalReason] : undefined,
        agentChanged: false,
      }),
    );
  }

  if (d.status === "expired") {
    return ok(
      factsLine("not renamed", {
        agent: `@agent-${agent}`,
        directive: d.id,
        reason: "expired",
        agentChanged: false,
      }),
    );
  }

  return ok(
    factsLine("pending", { agent: `@agent-${agent}`, ...pendingFacts(d, "rename") }),
  );
}

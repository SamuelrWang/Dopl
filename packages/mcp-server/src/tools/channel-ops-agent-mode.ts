/**
 * `dopl_channel` op="manage" action="posture": a management directive (held on the row via `holdRow`) asking that a running agent be re-postured.
 * It asks, never widens: the operator's machine clamps to its hand-set ceiling (`directive-agent-ops.js › setAgentMode`).
 * A null applied mode means "not reported" (older desktop), never "unclamped" (`channel-facts.ts › postureFacts`).
 * Unlike end/rename this kind IS gated by the launch-consent toggle, so `no-bridge` may mean the toggle is off.
 * The `channel-` filename prefix is load-bearing for the parity scans (`tool-group-files.ts`).
 */

import type {
  DoplClient,
  LaunchMessageMode,
  LaunchToolMode,
} from "@dopl/client";
import { LAUNCH_RETRY_ADVICE } from "./channel-directive-hold";
import { ok, type ToolResponse } from "./respond";
import { isErr, resolveChannelOr } from "./channel-shared";
import { agentTarget, isAgentTargetRefusal } from "./channel-agent-target";
import { fileAndHold, pendingFacts } from "./channel-ops-agent";
import { postureFacts } from "./channel-facts";
import { factsLine } from "./channel-facts";

/** What was asked, rendered; `-` for an axis left alone. */
function asked(tools?: LaunchToolMode, messages?: LaunchMessageMode): string {
  return `${tools ?? "-"}/${messages ?? "-"}`;
}

/**
 * Per agent, never per thread — no oldest-agent fallback.
 * "At least one axis" is checked in `channel-dispatch-agents.ts`, then by the route and the column CHECK.
 */
export async function opSetAgentMode(
  client: DoplClient,
  ref: string,
  agentId: string,
  modes: { tools?: LaunchToolMode; messages?: LaunchMessageMode },
  opts: { waitMs?: number } = {},
): Promise<ToolResponse> {
  // Target checked before the channel lookup: a refusal needing no round trip must not cost one.
  const target = agentTarget(agentId);
  if (isAgentTargetRefusal(target)) return target;
  const agent = target.agent;

  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;
  const want = asked(modes.tools, modes.messages);

  const filed = await fileAndHold(
    client,
    ref,
    {
      kind: "set_agent_mode",
      channel: channel.id,
      agentId: agent,
      tools: modes.tools,
      messages: modes.messages,
    },
    opts.waitMs,
  );
  if (filed.done) return filed.response;
  const d = filed.directive;

  // `taken`, not `set`: the machine applied something, not necessarily what was asked; `asked=` beside `posture=` shows the gap.
  if (d.status === "done") {
    return ok(
      factsLine("taken", {
        agent: `@agent-${agent}`,
        asked: want,
        ...postureFacts(d),
        filed: true,
      }),
    );
  }

  if (d.status === "refused") {
    return ok(
      factsLine("not re-postured", {
        agent: `@agent-${agent}`,
        asked: want,
        reason: d.refusalReason ?? undefined,
        // `-` when the machine named no reason, never a guessed verdict.
        retry: d.refusalReason ? LAUNCH_RETRY_ADVICE[d.refusalReason] : undefined,
        filed: true,
      }),
    );
  }

  if (d.status === "expired") {
    // Lapsed is not refused: nothing is outstanding and the agent keeps its posture.
    return ok(
      factsLine("not re-postured", {
        agent: `@agent-${agent}`,
        asked: want,
        directive: d.id,
        reason: "expired",
        filed: true,
      }),
    );
  }

  return ok(
    factsLine("pending", {
      agent: `@agent-${agent}`,
      asked: want,
      ...pendingFacts(d, "set_agent_mode"),
    }),
  );
}

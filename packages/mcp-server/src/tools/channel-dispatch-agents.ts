/**
 * `op="manage"`: the actions that ask the operator's own machine to act. Takes `args` and `client`
 * only: the server stamps the authenticated caller, so no argument here can reach another member's
 * machine; adding a parameter needs a written argument for why.
 * The `channel-` filename prefix is load-bearing for the parity and removed-vocabulary scans.
 */

import type { DoplClient } from "@dopl/client";
import { err, missingParams, type ToolResponse } from "./respond";
import { opDirectAgent } from "./channel-ops-direct";
import { opLaunchAgent } from "./channel-ops-launch";
import { asAgentColorKey } from "./channel-ops-launch-color";
import { opEndAgent, opRenameAgent } from "./channel-ops-agent";
import { opSetAgentMode } from "./channel-ops-agent-mode";
import type { z } from "zod";
import type { ZodObject } from "zod";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import { CHANNEL_ACTIONS, type ManageAction } from "./channel-vocab";

/** The validated argument bag, exactly as `channel.ts`'s handler receives it. */
type ChannelArgs = z.infer<ZodObject<typeof CHANNEL_INPUT_SHAPE>>;

/**
 * `posture.chain` → wire. `inherit` must be absent, not `false`: `false` forbids chaining, absent
 * takes the operator's setting.
 */
const CHAIN_ON_WIRE: Record<"inherit" | "on" | "off", boolean | undefined> = {
  inherit: undefined,
  on: true,
  off: false,
};

/** True for an action this module answers; the per-op action vocabularies are disjoint. */
export function isManageAction(action: string): action is ManageAction {
  return (CHANNEL_ACTIONS.manage as readonly string[]).includes(action);
}

export async function dispatchManageAction(
  action: ManageAction,
  args: ChannelArgs,
  client: DoplClient,
): Promise<ToolResponse> {
  // The caller narrows the action union, so this switch is exhaustive with no `default`.
  switch (action) {
    case "launch": {
      const miss = missingParams('manage action="launch"', args, ["channel", "name"]);
      if (miss) return miss;
      return opLaunchAgent(client, args.channel as string, {
        name: args.name,
        thread: args.thread,
        // `body` is the launch goal on the wire.
        goal: args.body,
        model: args.model,
        // `runtime` picks the adapter, `model` a model inside it; neither is derived from the other.
        // Passed through: only the operator's desktop knows what it can start.
        runtime: args.runtime,
        // Id vs name (and ambiguity) is resolved server-side against the caller's visibility.
        identity: args.identity,
        // Must be forwarded: dropping it silently runs the agent at the operator's ceiling (F-438).
        tools: args.posture?.tools,
        messages: args.posture?.messages,
        chain: CHAIN_ON_WIRE[args.posture?.chain ?? "inherit"],
        // With a key, a re-issue after a timeout returns the first directive (`retry=existing`)
        // instead of starting a second agent.
        clientMsgId: args.client_msg_id,
        // Narrowed, not cast: the arg type arrives widened through `CHANNEL_INPUT_SHAPE`'s inference.
        // Whether the key is free is decided server-side.
        color: asAgentColorKey(args.color),
        waitMs: args.wait_ms,
      });
    }
    // `channel` is required though `to` names the target: it proves a membership row there.
    case "end": {
      const miss = missingParams('manage action="end"', args, ["channel", "to"]);
      if (miss) return miss;
      return opEndAgent(client, args.channel as string, args.to as string, {
        waitMs: args.wait_ms,
      });
    }
    case "rename": {
      const miss = missingParams('manage action="rename"', args, [
        "channel",
        "to",
      ]);
      if (miss) return miss;
      // Hand-written: `missingParams` counts "" as absent, but `name: ""` legally clears a display name.
      if (typeof args.name !== "string") {
        return err(
          'op="manage" action="rename" is missing required param: name. Pass the display name you want (one line), or the EMPTY STRING to clear the name back to "Agent #<id>".',
        );
      }
      return opRenameAgent(
        client,
        args.channel as string,
        args.to as string,
        args.name,
        { waitMs: args.wait_ms },
      );
    }
    // Asks, never widens (the machine clamps to the operator's ceiling); unlike end/rename it is
    // gated by that machine's launch toggle.
    case "posture": {
      const miss = missingParams('manage action="posture"', args, [
        "channel",
        "to",
      ]);
      if (miss) return miss;
      // Hand-written: `missingParams` cannot express "at least one of tools / messages".
      if (
        args.posture?.tools === undefined &&
        args.posture?.messages === undefined
      ) {
        return err(
          'op="manage" action="posture" is missing required params: pass posture with at least one of tools (in the agent\'s runtime\'s own words — claude manual..bypass, codex untrusted..never, cursor allowlist..run-everything) or messages (ask | auto_inbound | auto_outbound | auto_both). Passing one and omitting the other is normal — the omitted axis is left alone. ⚠ Whatever you pass is a REQUEST: your operator\'s machine narrows it to the ceiling they set by hand and never widens past it.',
        );
      }
      return opSetAgentMode(
        client,
        args.channel as string,
        args.to as string,
        { tools: args.posture.tools, messages: args.posture.messages },
        { waitMs: args.wait_ms },
      );
    }
    // A private turn via the directions mailbox, not a `send`; `to` has no fallback so it never
    // steers an agent the caller did not address.
    case "direct": {
      const miss = missingParams('manage action="direct"', args, [
        "channel",
        "to",
        "body",
      ]);
      if (miss) return miss;
      return opDirectAgent(
        client,
        args.channel as string,
        args.to as string,
        args.body as string,
        {
          thread: args.thread,
          clientMsgId: args.client_msg_id,
          waitMs: args.wait_ms,
        },
      );
    }
  }
}

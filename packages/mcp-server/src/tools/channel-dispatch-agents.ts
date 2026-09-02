/**
 * `op="manage"` — THE FIVE ACTIONS THAT ASK THE OPERATOR'S OWN MACHINE TO DO
 * SOMETHING: `launch`, `end`, `rename`, `posture` and `direct`.
 *
 * ⚠ SPLIT OUT OF `channel.ts` ON 2026-09-01 and kept split by the collapse (B8,
 * 2026-09-02), because the seam is not arithmetic: these five are the ops that
 * reach a MACHINE rather than a room. Each files a directive and holds for an
 * answer, each can come back `refused` out of one closed vocabulary, and no
 * other op on this tool reads that vocabulary at all. ⚠ `read_directions` is NOT
 * here any more — reading the mailbox is `op="status"`, beside the sessions it
 * belongs to; this module is the WRITE half of that lane and nothing else.
 *
 * 🔒 **IT TAKES `args` AND `client` AND NOTHING ELSE, AND THAT IS THE FENCE
 * RESTATED RATHER THAN A CONVENIENCE.** None of the five reads the caller
 * identity, the runtime stamp, the admin flag or the container lock: a manage
 * action reaches the caller's OWN operator BY CONSTRUCTION, because the server
 * stamps the authenticated caller and there is no argument on this lane that
 * could name anybody else. ⚠ Adding a parameter here is how that stops being
 * true, so a widening needs the argument for why, in writing.
 *
 * ⚠ THE ACTION UNION IS NARROWED BY THE CALLER, so this switch is exhaustive
 * over exactly five words and needs no `default`. `channel.ts`'s own switch is
 * exhaustive over the op union in the same way, which is what proves both
 * handlers always return.
 *
 * ⚠ `channel-` filename prefix is REQUIRED: the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`channel-law.test.ts`, `law-scan.test.ts`) read every non-test `channel-*.ts`
 * in this directory.
 */

import type { DoplClient } from "@dopl/client";
import { err, missingParams, type ToolResponse } from "./respond";
import { opDirectAgent } from "./channel-ops-direct";
import { opLaunchAgent } from "./channel-ops-launch";
import { opEndAgent, opRenameAgent } from "./channel-ops-agent";
import { opSetAgentMode } from "./channel-ops-agent-mode";
import type { z } from "zod";
import type { ZodObject } from "zod";
import { CHANNEL_ACTIONS, CHANNEL_INPUT_SHAPE, type ManageAction } from "./channel-schema";

/** The validated argument bag, exactly as `channel.ts`'s handler receives it. */
type ChannelArgs = z.infer<ZodObject<typeof CHANNEL_INPUT_SHAPE>>;

/**
 * `posture.chain`'s THREE published words → the wire's `boolean | undefined`.
 *
 * ⚠ **`inherit` IS `undefined`, NOT `false`, AND THAT DISTINCTION IS THE WHOLE
 * REASON THE ENUM EXISTS** (C11): `false` FORBIDS chaining and always narrows,
 * while absent takes the operator's channel setting, which may be ON. The
 * surface used to say that in a paragraph on an optional boolean, and the two
 * were flattened together in a live wire bug (GAP C, `directiveFrom`).
 */
const CHAIN_ON_WIRE: Record<"inherit" | "on" | "off", boolean | undefined> = {
  inherit: undefined,
  on: true,
  off: false,
};

/**
 * True for an action this module answers. ⚠ **THE ONE PLACE THE PAIRING IS
 * CHECKED**, and it exists because `action` is ONE flat enum over two
 * vocabularies: `manage` must not answer `open`, and `rooms` must not answer
 * `launch`. The two lists are disjoint, so membership settles the pair.
 */
export function isManageAction(action: string): action is ManageAction {
  return (CHANNEL_ACTIONS.manage as readonly string[]).includes(action);
}

export async function dispatchManageAction(
  action: ManageAction,
  args: ChannelArgs,
  client: DoplClient,
): Promise<ToolResponse> {
  switch (action) {
    // ⚠ ASKS THE OPERATOR'S OWN MACHINE TO START AN AGENT. Everything but
    // `channel` is optional. The action NEVER names an operator — the server
    // stamps the authenticated caller, because the only machine an agent may
    // ask is its own operator's, and no argument here could say otherwise.
    case "launch": {
      const miss = missingParams('manage action="launch"', args, ["channel"]);
      if (miss) return miss;
      return opLaunchAgent(client, args.channel as string, {
        thread: args.thread,
        // ⚠ **`goal` BECAME `body` (B8), AND IT IS THE SAME FIELD IT ALWAYS
        // WAS**: the text you send an agent. One surface had two names for
        // "what to say", and the launch one was the one nobody could guess.
        goal: args.body,
        model: args.model,
        // ⚠ PASSED THROUGH AS A STRING, NEVER PARSED HERE. Whether it is an
        // id or a name — and whether a name is ambiguous — is decided
        // SERVER-SIDE, against the caller's own template visibility, which
        // this process cannot evaluate.
        template: args.template,
        // ⚠ **THE POSTURE ASK, AND IT WAS DROPPED HERE FOR A WHOLE RELEASE**
        // (F-438, fixed 2026-09-02). The schema published these three, the
        // handler accepted them, the route validated them and the table has
        // columns for them — and this arm built its object without reading any
        // of them, so a caller asking for a NARROWER agent got the operator's
        // stored ceiling and was told nothing. The direction was safe (it could
        // only widen back to the ceiling, never past it), which is exactly why
        // nothing caught it: the row recorded "did not ask", which is what an
        // honest omission looks like too.
        tools: args.posture?.tools,
        messages: args.posture?.messages,
        // ⚠ THE ENUM IS THE CALLER'S, THE BOOLEAN IS THE WIRE'S, AND THE MAP IS
        // HERE (C11). `inherit` — and an omitted value — must reach the server
        // as ABSENT rather than as `false`: flattening the two was GAP C, a live
        // wire bug. Three words in, three states out, and no third meaning for
        // `undefined`.
        chain: CHAIN_ON_WIRE[args.posture?.chain ?? "inherit"],
        // ⚠ THE ONE THING THAT MAKES THE DOCTRINE'S "do NOT issue it again"
        // TRUE IN CODE (A10/G10). Without a key a re-issue after a timeout files
        // a SECOND directive and starts a SECOND agent on the same work; with
        // one, the server hands back the first request's directive and the
        // result says `retry=existing`.
        clientMsgId: args.client_msg_id,
        waitMs: args.wait_ms,
      });
    }
    // ⚠ END ONE OF THE OPERATOR'S OWN RUNNING AGENTS. The SAME mailbox
    // `launch` writes, with `kind: "end"` — so the machine decides, a refusal is
    // normal and a timeout is PENDING rather than failed. ⚠ `channel` IS
    // REQUIRED even though `to` addresses the target on its own: the create
    // proves a MEMBERSHIP ROW there, which is what stops this being a bare
    // "end agent <id>" primitive.
    case "end": {
      const miss = missingParams('manage action="end"', args, ["channel", "to"]);
      if (miss) return miss;
      return opEndAgent(client, args.channel as string, args.to as string, {
        waitMs: args.wait_ms,
      });
    }
    // ⚠ RELABEL ONE OF THE OPERATOR'S OWN AGENTS — DISPLAY ONLY, on that one
    // machine.
    case "rename": {
      const miss = missingParams('manage action="rename"', args, [
        "channel",
        "to",
      ]);
      if (miss) return miss;
      // ⚠ NOT `missingParams`, AND THAT IS THE WHOLE REASON THIS BRANCH IS
      // HAND-WRITTEN. That helper counts the EMPTY STRING as absent, which is
      // right for every other param on this tool and wrong for exactly this
      // one: `name: ""` is the legal, deliberate gesture that CLEARS a display
      // name. Routing it through the helper would delete the only way to undo a
      // rename and report it as a missing argument.
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
    // ⚠ RE-POSTURE ONE OF THE OPERATOR'S OWN RUNNING AGENTS — the SAME mailbox
    // again, `kind: "set_agent_mode"`. ⚠ IT ASKS AND NEVER WIDENS: that machine
    // clamps each axis to the operator's own stored ceiling, so nothing here
    // may narrate a posture as granted. ⚠ UNLIKE `end` AND `rename` IT **IS**
    // GATED BY THAT MACHINE'S LAUNCH TOGGLE — a posture can cause compute to be
    // spent on the operator's hardware, which a stop verb and a label cannot.
    case "posture": {
      const miss = missingParams('manage action="posture"', args, [
        "channel",
        "to",
      ]);
      if (miss) return miss;
      // ⚠ **NOT `missingParams`, AND THAT IS THE WHOLE REASON THIS CHECK IS
      // HAND-WRITTEN** — the same move `rename`'s `name` check makes, for the
      // neighbouring reason. That helper answers ONE question per param ("is
      // this one present?") and cannot express "at least one of these two":
      // demanding both would delete the ordinary case (move one axis, leave the
      // other alone), and demanding neither would let an empty ask reach a row
      // whose only possible answer is a refusal for a request that was never
      // expressible. ⚠ The route's zod refuses it again and the column CHECK a
      // third time at rest; this is the only one of the three that costs the
      // caller nothing — no row, no claim, no two-minute round trip.
      if (
        args.posture?.tools === undefined &&
        args.posture?.messages === undefined
      ) {
        return err(
          'op="manage" action="posture" is missing required params: pass posture with at least one of tools (manual | accept_edits | auto | bypass) or messages (ask | auto_inbound | auto_outbound | auto_both). Passing one and omitting the other is normal — the omitted axis is left alone. ⚠ Whatever you pass is a REQUEST: your operator\'s machine narrows it to the ceiling they set by hand and never widens past it.',
        );
      }
      // ⚠ THE TWO AXES GO THROUGH UNTOUCHED. The schema's enum is the only
      // shape check this process has; the CEILING lives on the operator's
      // machine, so nothing here may predict the outcome.
      return opSetAgentMode(
        client,
        args.channel as string,
        args.to as string,
        { tools: args.posture.tools, messages: args.posture.messages },
        { waitMs: args.wait_ms },
      );
    }
    // ⚠ DIRECT ONE OF THE OPERATOR'S OWN RUNNING AGENTS, PRIVATELY — a mailbox
    // the operator's OWN machine claims, never a message and never another
    // member's machine. ⚠ **IT DID NOT FOLD INTO `send`**, and the spec row that
    // said it should is recorded as owed rather than shipped: a directed `send`
    // stamps `recipient_agent_ids` and predicts a verdict, but nothing files a
    // `channel_agent_directions` row for a dormant agent, so folding it would
    // have deleted the private lane rather than moving it. `to` is REQUIRED and
    // has no fallback: this reaches a PRIVATE TURN, and resolving to "the oldest
    // agent on the thread" would steer one the caller did not address.
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
        // ⚠ `client_msg_id` IS THE SHARED PARAM, NOT A SECOND ONE (A10/G10,
        // 2026-09-02). The same field `send` already takes, carrying the same
        // promise on a second lane: re-sending one returns the stored row
        // instead of filing a second. A per-action spelling would be a second
        // idempotency vocabulary on one tool.
        {
          thread: args.thread,
          clientMsgId: args.client_msg_id,
          waitMs: args.wait_ms,
        },
      );
    }
  }
}

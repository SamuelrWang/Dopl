/**
 * **THE AGENT VIEW'S OWN LANE** — the 1:1 turns between Samuel and his agent, and the
 * channel messages that ARRIVED for it. What the desktop bridge would have pushed, which
 * a browser cannot feed, so the scene scripts it.
 *
 * Its own file for `demo-info-data.ts`'s reason: `demo-data.ts` is the CHANNEL's data and
 * had grown past the 500-line cap. This is the one feed the transcript does not carry.
 *
 * They are WIRE SHAPES, not a second model — `DesktopNarrationEntry` is the product's own
 * type, so a field that moves fails the typecheck here rather than drifting into a
 * look-alike.
 *
 * One clock: every stamp is an offset off `demo-data.ts`'s `NOW_MS`.
 */

import type { DesktopNarrationEntry } from "@/shared/lib/spa-bridge";
import {
  AGENT_INDEX,
  NOW_MS,
} from "./demo-data";
import {
  citedMessage,
} from "./demo-transcript";
import { at, reached, type StepId } from "./demo-steps";

const dm = (
  step: StepId,
  lane: "operator" | "private",
  text: string,
  secondsAgo: number,
): { step: StepId; entry: DesktopNarrationEntry } => ({
  step,
  entry: {
    at: NOW_MS - secondsAgo * 1000,
    kind: lane,
    lane,
    text,
  },
});

/**
 * **WHAT WOKE THE AGENT** (Samuel, 2026-10-12: the agent view must show the
 * "Message received from …" banner the real one does).
 *
 * ⚠ **THE SCENE EMITTED NO `inbound` LANE AT ALL**, only `operator` and `private`, so
 * `agent-stream.tsx`'s `InboundBox` arm was unreachable and the panel showed one half
 * of every exchange — the exact gap #3081 opened that box to close.
 *
 * ⚠ **THE FACE IS THE PRODUCT'S OWN AND IS NOT FORKED HERE.** This feeds
 * `lane: "inbound"` through `DesktopNarrationEntry`'s existing fields and renders
 * `agent-stream-inbound-box.tsx` untouched, so the human-versus-agent colouring landing
 * on `ui/received-banner-color` reaches this scene the day it merges, with no edit here.
 *
 * 🔴 **AND THAT IS WHY ONE THING IS STUBBED.** `DesktopNarrationEntry` carries
 * `senderName` and `fromOperator` and NOTHING that says whether the sender was a human
 * or an agent, nor a colour — the new fields are going onto `ChannelMessage`, which is
 * not what feeds this lane. So the two entries below are distinguishable only by the
 * words in `senderName` today, and both draw the current neutral banner. Flagged to
 * @cleanup-orchestrator: the inbound lane needs its own carrier for that fact.
 */
/**
 * ⚠ **THE WORDS AND THE SENDER ARE READ OFF THE POST, NEVER RETYPED HERE.** An inbound
 * entry IS a channel message as this agent received it, so authoring the text beside the
 * transcript's own copy would be two strings that have to be edited together — and the
 * mentions inbox already proved how that ends (`demo-data.ts › citedMessage`). It also
 * keeps the scenario rewrite a DATA change: reword the post and the banner follows.
 *
 * `step` stays explicit: when a message ARRIVES at the agent is a different beat from
 * when it was posted, and only the arrival belongs to this lane.
 */
const inbound = (
  step: StepId,
  messageId: string,
  secondsAgo: number,
): { step: StepId; entry: DesktopNarrationEntry } => {
  const { message, agentId, agentColor } = citedMessage(messageId);
  // An agent's post is captioned with the AGENT's name; a member's with their own.
  const senderName = agentId
    ? AGENT_INDEX.get(agentId)?.displayName
    : message.authorName;
  if (!senderName) {
    throw new Error(`banner demo: no sender name for inbound ${messageId}`);
  }
  const fromAgent = agentId !== null;
  return {
    step,
    entry: {
      at: NOW_MS - secondsAgo * 1000,
      kind: "inbound",
      lane: "inbound",
      text: message.body,
      senderName,
      /**
       * **THE BANNER'S PAINT CARRIER** (`ui/received-banner-color`, merged 2026-10-12).
       *
       * ⚠ **THE `as` CAST IS GONE, WHICH WAS THE WHOLE POINT OF THE FOLLOW-UP.** These
       * three fields were written here before they existed on `DesktopNarrationEntry`,
       * admitted by a cast, with three probes standing in for the compiler. The fields
       * have landed, so the cast is deleted and the TYPE now checks the shape — a
       * misspelled key is a build error rather than a pill that quietly never paints.
       *
       * ⚠ **THE GATE IS MIRRORED, NOT RE-DECIDED.** The reader drops `senderAgentName`
       * and `senderColor` unless `authorKind === "agent"`, so this omits them on a
       * member's post rather than sending values it knows will be discarded.
       */
      authorKind: fromAgent ? "agent" : "user",
      ...(fromAgent
        ? { senderAgentName: senderName, senderColor: agentColor ?? undefined }
        : {}),
    },
  };
};

/**
 * ⚠ **THE STAMPS ARE THE STREAM'S ORDER** (`agent-stream-model.ts › buildAgentStream`
 * sorts on `at`), and every one of them sits between the agent's first channel post
 * (`agent-msg-2`, 2 minutes back) and its second (`agent-post-2`, now) — so the lane
 * reads: posted, what arrived, the private exchange, posted again.
 *
 * ⚠ An inbound's stamp is when the message REACHED this agent, which is at or after the
 * channel post it carries, never before it.
 */
const DM_SCRIPT: ReadonlyArray<{ step: StepId; entry: DesktopNarrationEntry }> =
  [
    /**
     * **WHAT WOKE THIS CODER: ITS OWN BRIEF, FROM ANOTHER AGENT.**
     *
     * ⚠ The brief is `brief-1`, posted by Cleanup Planner, so this is the agent→agent
     * banner in the sending agent's colour. The coder was launched BY that orchestrator
     * and briefed by it, so there is no human sender in this agent's lane at all, which
     * is the point of v3: the work was handed over without a person in the middle.
     */
    inbound("agent-open", "demo-m18", 100),
    dm(
      "dm-user-1",
      "operator",
      "don't fix the ordering yet. just tell me if the post ever lands",
      70,
    ),
    dm(
      "dm-agent-1",
      "private",
      "It doesn't. The socket closes first, so the final post races the shutdown and loses. Want me to write that up before touching anything?",
      52,
    ),
    dm("dm-user-2", "operator", "yes write it up first", 34),
    dm("dm-agent-2", "private", "Writing it up now.", 18),
  ];

export function narrationAt(step: number): DesktopNarrationEntry[] {
  return DM_SCRIPT.filter((s) => reached(step, s.step)).map((s) => s.entry);
}


/** The operator's own DM landing ON this beat, typed out like a channel post. */
export function typedDmAt(step: number): DesktopNarrationEntry | null {
  return (
    DM_SCRIPT.find((s) => at(step, s.step) && s.entry.lane === "operator")
      ?.entry ?? null
  );
}

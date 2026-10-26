/**
 * **THE HARDCODED "NEEDS YOUR DECISION" POST** in #tech-debt (Samuel, 2026-10-22, ask 6b:
 * "have the channel agent put one of those boxes, hardcode that into the Techdet channel so
 * I can see it"). STAGING-ONLY FIXTURE — nothing in the landing demo or the product knows
 * about it.
 *
 * It is a real product shape, not a mock of one: a `channel_messages` row whose
 * `metadata.display` is a v2 display envelope with a `choice` block
 * (`display/core/types.ts`), which is exactly what `dopl_request_decision` writes. So the
 * product's own reader (`view-model-display.ts › displayViewOf`) builds the card's view from
 * it, and the staged face (`home/decision-card.tsx`) draws what a real decision would carry.
 *
 * ⚠ IT TAGS THE VIEWER, and that is what makes it answerable: `display/core/answerers.ts ›
 * answerersOf` reads the server's mention set, else the author account. Without the tag the
 * card renders read-only and Samuel could not press anything.
 */

import {
  DISPLAY_METADATA_KEY,
  DISPLAY_SPEC_VERSION,
  type DisplayEnvelopeV2,
} from "@/features/display/core/types";
import { MENTIONS_METADATA_KEY } from "@/features/channels/lib/mentions";
import type { ChannelMessage } from "@/features/channels/types";
import {
  AGENT_IDS,
  CURRENT_USER_ID,
  DEMO_CHANNEL,
  minsAgo,
  OPEN_THREAD_ID,
} from "./demo-imports";

/** The asking agent: the coder already working inside the teardown thread. */
const ASKING_AGENT = AGENT_IDS.teardown;

const DECISION: DisplayEnvelopeV2 = {
  spec_version: DISPLAY_SPEC_VERSION,
  display_id: "d-teardown1",
  origin: "dopl_request_decision",
  blocks: [
    {
      id: "q",
      type: "heading",
      text: "Ship the teardown fix behind a flag, or hold it for the next release?",
    },
    {
      id: "ctx",
      type: "text",
      content:
        "The leak is fixed and the repro passes, but the fix changes how sessions are closed on every surface. Two of the three coders are still mid review.",
    },
    {
      id: "pick",
      type: "choice",
      options: [
        {
          label: "Ship behind a flag",
          description:
            "Goes out today with the flag off. You turn it on per workspace once review lands.",
          recommended: true,
          why: "The repro is covered and the flag keeps today's behaviour for everyone until you say otherwise.",
        },
        {
          label: "Hold for the next release",
          description:
            "Nothing changes this week. Review finishes first, and the leak stays in production until then.",
        },
        {
          label: "Ship it on",
          description:
            "Every workspace gets the new teardown path immediately, before the other two reviews land.",
        },
      ],
    },
  ],
};

/**
 * The decision post, appended to the tech-debt transcript after the scripted ones.
 * `seq` and `createdAt` sit past the last scripted message so it lands at the bottom.
 */
export function decisionMessage(afterSeq: number): ChannelMessage {
  return {
    id: "demo-decision-1",
    seq: afterSeq + 1,
    channelId: DEMO_CHANNEL.id,
    authorUserId: CURRENT_USER_ID,
    authorKind: "agent",
    kind: "message",
    // The plain-text fallback the product keeps for readers that do not know displays.
    body: "Ship the teardown fix behind a flag, or hold it for the next release?",
    metadata: {
      threadId: OPEN_THREAD_ID,
      [MENTIONS_METADATA_KEY]: [CURRENT_USER_ID],
      [DISPLAY_METADATA_KEY]: DECISION,
    },
    // `view-model.ts` reads the agent out of the stamp's second segment.
    clientMsgId: `agent-${ASKING_AGENT}-99`,
    createdAt: minsAgo(1),
    authorName: null,
    authorAvatarUrl: null,
  };
}

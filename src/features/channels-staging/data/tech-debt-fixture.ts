/**
 * #tech-debt — THE LANDING DEMO'S CHANNEL, in its finished state: every scripted post, thread,
 * session, mention and 1:1 turn the timeline reveals by its `hold` beat, read straight off the
 * demo's own step-gated selectors (`banner-demo/demo-transcript.ts › messagesAt` etc.). Nothing
 * is retyped, so a reworded demo line shows up here on the next reload.
 *
 * The additions: the channel's older threads ahead of the script (`staging-history.ts`), and a
 * short 1:1 lane for Cleanup Planner (the demo only scripts Teardown Order Fix's), so opening
 * either of the viewer's agents shows a conversation.
 */

import {
  AGENT_IDS,
  DEMO_CHANNEL,
  HOME_ROW_ID_DEMO,
  MEMBERS,
  MY_SESSIONS,
  PEER_NOTICE,
  PEER_SCOUT,
  PEER_TRIAGE,
  PEER_WAKE,
  SERVER_SESSIONS,
} from "./demo-imports";
import { messagesAt, threadsAt } from "@/features/marketing/components/banner-demo/demo-transcript";
import { narrationAt } from "@/features/marketing/components/banner-demo/demo-narration";
import {
  ACTIVITY_BINS,
  mentionsAt,
} from "@/features/marketing/components/banner-demo/demo-info-data";
import { stepIndex } from "@/features/marketing/components/banner-demo/demo-steps";
import { dmOf, inboundOf, minsAgo, postsFor, settleThreads } from "./staging-builders";
import { techDebtHistory } from "./staging-history";
import { decisionMessage } from "./decision-fixture";
import type { ChannelFixture } from "./staging-fixture-types";

/** The beat everything has landed on, before the loop's reset fade. */
export const FINAL_STEP = stepIndex("hold");

export function techDebtFixture(): ChannelFixture {
  const past = techDebtHistory(DEMO_CHANNEL.id, postsFor(DEMO_CHANNEL.id, "debt"));
  // The script numbers from 1; it moves up past the older threads it follows.
  const lift = past.messages.length;
  const scripted = messagesAt(FINAL_STEP).map((m) => ({ ...m, seq: m.seq + lift }));
  // STAGING (ask 6b): one hardcoded "needs your decision" post at the bottom, so the
  // restyled card is visible on /playground/channels. See `./decision-fixture.ts`.
  const messages = [
    ...past.messages,
    ...scripted,
    decisionMessage(scripted[scripted.length - 1]?.seq ?? lift),
  ];
  const split = messages.find((m) => m.body.startsWith("@debt-triage you have"));
  return {
    kind: "channel",
    rowId: HOME_ROW_ID_DEMO,
    well: "recent",
    unread: false,
    mentionsPill: 0,
    // The demo passes `favorited` to the pane.
    favorited: true,
    channel: { ...DEMO_CHANNEL, createdAt: minsAgo(60 * 24 * 60) },
    members: MEMBERS,
    messages,
    threads: settleThreads([...threadsAt(FINAL_STEP), ...past.threads], messages),
    sessions: [...MY_SESSIONS],
    peers: [PEER_TRIAGE, PEER_SCOUT, PEER_NOTICE, PEER_WAKE],
    serverSessions: [...SERVER_SESSIONS],
    mentions: mentionsAt(FINAL_STEP).map((m) => ({ ...m, seq: m.seq + lift })),
    narration: {
      [AGENT_IDS.teardown]: narrationAt(FINAL_STEP),
      [AGENT_IDS.planner]: [
        dmOf("operator", "split the cleanup with the other two orchestrators. take whatever has a repro", 330),
        dmOf(
          "private",
          "Read the channel and the KB. Session teardown has a repro already, so I'll take that and leave the flakes to Debt Triage.",
          300
        ),
        ...(split ? [inboundOf(split, 240)] : []),
        dmOf("operator", "launch coders for it, one per symptom", 200),
        dmOf("private", "Three coders, one per symptom. Briefing them in the thread now.", 170),
      ],
    },
    activity: ACTIVITY_BINS,
  };
}

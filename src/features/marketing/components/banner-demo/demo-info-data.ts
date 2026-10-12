/**
 * The Info tab's scripted facts: the mentions inbox and the 31-day activity
 * series the /home record pane's column renders. Its own file because these are
 * the two reads the marketing tree has nothing to call.
 *
 * They are WIRE SHAPES, not a second model — `ChannelMention` and `ActivityBin`
 * are the product's own types, so a field that moves fails the typecheck here
 * rather than drifting into a look-alike.
 *
 * One clock: every stamp comes from `demo-data.ts`'s `minsAgo` / `NOW_MS`.
 */

import type { ChannelMention } from "@/features/channels/types";
import type { ActivityBin } from "@/features/channels/components/thread-activity";
import { AGENT_INDEX, CHANNEL_ID, FACE, NOW_MS, citedMessage } from "./demo-data";
import { reached, type StepId } from "./demo-steps";

/**
 * My mentions in this channel, revealed with the post each one cites.
 *
 * (2026-09-15) One unread, one read: the list has no badge on /home, so an unread
 * row's own dot and tint need both states on screen to be visible at all.
 * `threadId: null` — a channel-level post, which is every post in this scene.
 *
 * ⚠ **EVERY FIELD BUT THE SNIPPET IS DERIVED FROM THE POST IT CITES** (`demo-data.ts ›
 * citedMessage`), so the inbox cannot disagree with the transcript about who wrote a
 * message, when, or in which colour. The two rows used to author all of it by hand and
 * two of those answers had gone stale — see that function's header.
 *
 * The snippet stays authored: it is a server-side excerpt, which the demo has nothing
 * to compute from.
 */
function mention(
  messageId: string,
  snippet: string,
  read: boolean,
): { step: StepId; mention: ChannelMention } {
  const { step, message, agentId, agentColor } = citedMessage(messageId);
  const author = message.authorUserId;
  if (!author) {
    throw new Error(`banner demo: mention cites authorless message ${messageId}`);
  }
  return {
    step,
    mention: {
      messageId: message.id,
      seq: message.seq,
      channelId: CHANNEL_ID,
      threadId: null,
      authorUserId: author,
      authorKind: message.authorKind,
      authorName: message.authorName,
      authorAvatarUrl: FACE[author as keyof typeof FACE] ?? null,
      authorAgentId: agentId,
      authorAgentName: agentId
        ? (AGENT_INDEX.get(agentId)?.displayName ?? null)
        : null,
      authorAgentColor: agentColor,
      snippet,
      createdAt: message.createdAt,
      read,
    },
  };
}

/** Newest first, the server's own `seq DESC`, which `MentionsList` never re-sorts. */
const MENTION_SCRIPT: ReadonlyArray<{ step: StepId; mention: ChannelMention }> = [
  mention(
    "demo-m10",
    "@Samuel Director+ at 50–500 headcount closed 3× faster — 74 of the 186.",
    false,
  ),
  mention("demo-m2", "@Samuel half of them are missing titles in the CRM again.", true),
];

/**
 * **THE INBOX AT THIS BEAT** (Samuel, 2026-10-12: a mention must appear at the moment it
 * happens).
 *
 * ⚠ **IT WAS THE ONE FEED IN THE SCENE THAT WAS NOT STEP-GATED.** `demo-scene.tsx` passed
 * the bare array while every sibling went through `messagesAt` / `narrationAt` /
 * `homeRowsAt`, so both rows sat in the column from the first frame — including one citing
 * a post that had not been made yet.
 *
 * ⚠ Still newest first: the gate FILTERS, it never re-orders.
 */
export function mentionsAt(step: number): ChannelMention[] {
  return MENTION_SCRIPT.filter((m) => reached(step, m.step)).map((m) => m.mention);
}

/**
 * 31 UTC days of message counts — what
 * `GET …/overview-series?metric=messages&channelId=` answers, and what
 * `ThreadActivityStrip` quantises into its shade ramp.
 *
 * Real zeroes, not gaps: the strip renders a measured zero as an empty well and
 * nothing at all for an absent series (INVARIANTS §11). 31 bins, the route's own
 * window — a shorter series is a different picture from the one /home draws.
 */
const COUNTS = [
  0, 2, 0, 0, 5, 3, 1, 0, 0, 4, 9, 6, 2, 0, 0, 1, 7, 12, 8, 3, 0, 0, 2, 11, 14,
  9, 4, 0, 0, 6, 17,
] as const;

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD`, UTC — the route's own key, and what the strip's title reads. */
function utcDay(msBack: number): string {
  return new Date(NOW_MS - msBack).toISOString().slice(0, 10);
}

export const ACTIVITY_BINS: readonly ActivityBin[] = COUNTS.map(
  (count, i) => ({
    date: utcDay((COUNTS.length - 1 - i) * DAY_MS),
    count,
  })
);

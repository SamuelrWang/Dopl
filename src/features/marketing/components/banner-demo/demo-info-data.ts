/**
 * THE **Info** TAB'S SCRIPTED FACTS — the mentions inbox and the 31-day
 * activity series the /home record pane's column renders.
 *
 * ⚠ ITS OWN FILE because `demo-data.ts` is at the 500-line cap the root lint
 * enforces (`max-lines`), and because these are the two reads the marketing
 * tree has nothing to call: `GET /api/channels/{id}/mentions` and
 * `GET /api/workspaces/{segment}/overview-series`. Everything else on that tab
 * is derived from the roster and the channel row `demo-data.ts` already builds.
 *
 * ⚠ **THEY ARE WIRE SHAPES, NOT A SECOND MODEL** — `ChannelMention` and
 * `ActivityBin` are the product's own types, so a field that moves fails the
 * typecheck here rather than drifting into a look-alike.
 *
 * ⚠ ONE CLOCK. Every stamp comes from `demo-data.ts`'s `minsAgo` / `NOW_MS`,
 * anchored once per load — a second `Date.now()` here would drift the column's
 * dates off the transcript's.
 */

import type { ChannelMention } from "@/features/channels/types";
import type { ActivityBin } from "@/features/channels/components/thread-activity";
import {
  AGENT_IDS,
  CHANNEL_ID,
  CURRENT_USER_ID,
  FACE,
  NOW_MS,
  minsAgo,
} from "./demo-data";

/**
 * MY mentions in this channel, newest first — the server's `seq DESC` order,
 * which `MentionsList` never re-sorts.
 *
 * ⚠ **ONE UNREAD, ONE READ.** The list has no badge on /home (Samuel,
 * 2026-09-15): an unread row carries its own dot and tint, so the scene needs
 * both states on screen for that distinction to be visible at all.
 * ⚠ `threadId: null` — a CHANNEL-LEVEL post, which is every post in this scene.
 */
export const MENTIONS: ChannelMention[] = [
  {
    messageId: "demo-m9",
    seq: 9,
    channelId: CHANNEL_ID,
    threadId: null,
    authorUserId: "demo-u-anthony",
    authorKind: "agent",
    authorName: "Anthony Reyes",
    authorAvatarUrl: FACE["demo-u-anthony"],
    authorAgentId: AGENT_IDS.analyst,
    authorAgentName: "Pipeline Analyst",
    authorAgentColor: "agent-03",
    snippet: "@Samuel Director+ at 50–500 headcount closed 3× faster — 74 of the 186.",
    createdAt: minsAgo(1),
    read: false,
  },
  {
    messageId: "demo-m2",
    seq: 2,
    channelId: CHANNEL_ID,
    threadId: null,
    authorUserId: "demo-u-grace",
    authorKind: "user",
    authorName: "Grace Okafor",
    authorAvatarUrl: FACE["demo-u-grace"],
    authorAgentId: null,
    authorAgentName: null,
    authorAgentColor: null,
    snippet: "@Samuel half of them are missing titles in the CRM again.",
    createdAt: minsAgo(24),
    read: true,
  },
];

/** The viewer of that inbox. ⚠ Stated once so the tab and the transcript agree. */
export const MENTIONS_VIEWER = CURRENT_USER_ID;

/**
 * 31 UTC DAYS OF MESSAGE COUNTS — what
 * `GET …/overview-series?metric=messages&channelId=` answers, and what
 * `ThreadActivityStrip` quantises into its shade ramp.
 *
 * ⚠ **REAL ZEROES, NOT GAPS.** The strip renders a MEASURED zero as an empty
 * well and renders nothing at all for an absent series (INVARIANTS §11), so a
 * quiet day has to be a counted `0` — dropping the bin would say something
 * different.
 * ⚠ **31 BINS, THE ROUTE'S OWN WINDOW.** A shorter series is a shorter strip,
 * which is a different picture from the one /home draws.
 */
const COUNTS = [
  0, 2, 0, 0, 5, 3, 1, 0, 0, 4, 9, 6, 2, 0, 0, 1, 7, 12, 8, 3, 0, 0, 2, 11, 14,
  9, 4, 0, 0, 6, 17,
] as const;

const DAY_MS = 86_400_000;

/** ⚠ `YYYY-MM-DD`, UTC — the route's own key, and what the strip's title reads. */
function utcDay(msBack: number): string {
  return new Date(NOW_MS - msBack).toISOString().slice(0, 10);
}

export const ACTIVITY_BINS: readonly ActivityBin[] = COUNTS.map(
  (count, i) => ({
    date: utcDay((COUNTS.length - 1 - i) * DAY_MS),
    count,
  })
);

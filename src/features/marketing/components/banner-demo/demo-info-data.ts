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
import {
  AGENT_INDEX,
  CHANNEL_ID,
  FACE,
  MEMBERS,
  NOW_MS,
  PRIOR_AGENT_COLOR,
  U,
  minsAgo,
} from "./demo-data";
import {
  citedMessage,
} from "./demo-transcript";
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
/**
 * **THE SERVER'S EXCERPT, AS AN EXCERPT.**
 *
 * ⚠ **DERIVED, BECAUSE THE AUTHORED VERSION WAS THE LAST DUPLICATE IN THE SCENE.** The
 * snippet used to be typed out beside the post it quotes, which is the same two-copies
 * problem that had already mis-keyed these rows once. Cutting the body is what the
 * server does, so cutting it here is both honest and un-driftable.
 */
const SNIPPET_MAX = 90;
/**
 * The viewer's own tag. (2026-10-15, Samuel) The row clamps to two lines, so a tag
 * past the cut left a mention preview that never showed the mention.
 */
const VIEWER_TAG = `@${(MEMBERS.find((m) => m.userId === U.samuel)?.displayName ?? "").split(" ")[0]}`;
/** Characters of lead-in kept before an off-screen tag when the window slides. */
const LEAD_IN = 28;
/** The visible start of a two-line clamp, roughly: a tag later than this is cut. */
const VISIBLE_CHARS = 60;
function excerpt(body: string): string {
  const tag = body.indexOf(VIEWER_TAG);
  // The tag would sit past the clamp: window the body AROUND it instead, as
  // "…words words @Name words words…", so the mention is on screen.
  if (tag > VISIBLE_CHARS) {
    const from = body.indexOf(" ", tag - LEAD_IN) + 1;
    const rest = body.slice(from);
    const cut = rest.length <= SNIPPET_MAX ? rest : rest.slice(0, SNIPPET_MAX);
    const lastSpace = cut.lastIndexOf(" ");
    const tail =
      rest.length <= SNIPPET_MAX
        ? cut
        : `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
    return `…${tail}`;
  }
  if (body.length <= SNIPPET_MAX) return body;
  const cut = body.slice(0, SNIPPET_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function mention(
  messageId: string,
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
      snippet: excerpt(message.body),
      createdAt: message.createdAt,
      read,
    },
  };
}

/**
 * Newest first, the server's own `seq DESC`, which `MentionsList` never re-sorts.
 *
 * Both rows are tags OF Samuel by somebody else's agent, which is what a real inbox
 * holds: his own agents' posts are authored under his account and the mention set
 * excludes the author, so they could never file a row here.
 */
/**
 * **A PRIOR EXCHANGE** (Samuel, 2026-10-15): the inbox opened empty ("No messages tag
 * you in this channel yet"), which read as a brand-new channel. One older, read tag
 * from an agent that never appears in the scene, about different work, sits there
 * from the first frame.
 *
 * ⚠ **THE ONE ROW NOT CITING A SCRIPTED POST**, by design — the post predates the
 * scene. `demo-script.test.ts` exempts it by this id.
 */
export const PRIOR_MENTION_ID = "demo-prior-1";
const PRIOR_AGENT_ID = "demo-a-invoice";
const PRIOR_MENTION: ChannelMention = {
  messageId: PRIOR_MENTION_ID,
  seq: 0,
  channelId: CHANNEL_ID,
  threadId: null,
  authorUserId: U.anthony,
  authorKind: "agent",
  authorName: MEMBERS.find((m) => m.userId === U.anthony)?.displayName ?? null,
  authorAvatarUrl: FACE[U.anthony as keyof typeof FACE] ?? null,
  authorAgentId: PRIOR_AGENT_ID,
  authorAgentName: "Invoice Reconciler",
  authorAgentColor: PRIOR_AGENT_COLOR,
  snippet: `${VIEWER_TAG} Q3 invoice export is reconciled. Three vendors still need your sign-off before Friday's close.`,
  createdAt: minsAgo(60 * 26),
  read: true,
};

const MENTION_SCRIPT: ReadonlyArray<{ step: StepId; mention: ChannelMention }> = [
  // `concurrent-3`, the orchestrator's question to him, still unread.
  mention("demo-m24", false),
  // `split-2`, where the orchestrators handed him the teardown work.
  mention("demo-m10", true),
  // Before the scene: on screen from the first frame (see PRIOR_MENTION).
  { step: "channel-base", mention: PRIOR_MENTION },
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

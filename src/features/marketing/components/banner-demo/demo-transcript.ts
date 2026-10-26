/**
 * **THE TRANSCRIPT** — the scene's messages, the beat each one lands on, and the three
 * things the product reads off `metadata`: the mention set, the thread join and the
 * device a human sent it from.
 *
 * Split from `demo-data.ts` on the 500-line cap (`eslint.config.mjs › max-lines`), on a
 * one-way seam: that file owns the ROSTER (members, threads, agents, sessions) and knows
 * nothing about the script, this one builds the script out of it. Nothing imports back.
 *
 * ⚠ **THIS IS THE ONE PLACE THE APPROVED WORDING LIVES.** Source: KB `codebase-cleanup` ›
 * "Landing Demo Script v3 (for Samuel)", approved 2026-10-12, which is authoritative for
 * wording. Every other consumer DERIVES: the inbound banner through {@link citedMessage},
 * the mentions snippet by cutting a body. `demo-script.test.ts` fails if any sibling
 * module restates a line, because two hand-maintained copies of one string always
 * separate and this scene has already paid for that three times.
 */

import type { ChannelMessage, ChannelThread } from "@/features/channels/types";
import type { AgentColorKey } from "@dopl/contracts";
import {
  MENTIONS_METADATA_KEY,
  resolveMentions,
} from "@/features/channels/lib/mentions";
import { at, reached, type StepId } from "./demo-steps";
import {
  AGENT_COLORS,
  AGENT_IDS,
  CHANNEL_ID,
  MEMBERS,
  THREADS,
  THREAD_IDS,
  U,
  minsAgo,
} from "./demo-data";

/* ── The transcript, revealed step by step ────────────────────────── */

/**
 * **THE MENTION SET, RESOLVED THE WAY THE SERVER RESOLVES IT** (Samuel, 2026-10-12:
 * messages must render mention pills).
 *
 * ⚠ **DERIVED FROM THE BODY, NEVER AUTHORED BESIDE IT.** `metadata` was `{}` on every
 * message in this scene, and `mentionsMe` is read off `metadata.mentionedUserIds`
 * (`view-model-rows.ts › channelRows`) — so no `@name` in any body could ever tint, be
 * counted, or reach the mentions inbox. Running `lib/mentions.ts › resolveMentions`,
 * which is the SAME function the server's write path uses
 * (`service-writes-metadata.ts › resolvePostMetadata`), means a tag typed into a body
 * resolves here exactly as it would in the product. That is what keeps the copy a
 * DATA change: write `@Grace` in a line and the pill, the highlight and the inbox row
 * follow with no code edit.
 *
 * ⚠ **THE AUTHOR IS EXCLUDED**, per that key's own contract ("author excluded"), so a
 * member tagging themselves does not light their own inbox.
 *
 * ⚠ **THE KEY IS STAMPED ONLY WHEN THE SET IS NON-EMPTY**, also per contract: absent
 * means "tags nobody", and an empty array would be a shape no stored row has.
 */
export function mentionMetadata(
  body: string,
  authorUserId: string | null,
): Record<string, unknown> {
  const ids = resolveMentions(body, MEMBERS).filter(
    (id) => id !== authorUserId,
  );
  return ids.length > 0 ? { [MENTIONS_METADATA_KEY]: ids } : {};
}

let seq = 0;
function msg(
  step: StepId,
  authorUserId: string | null,
  body: string,
  minutesAgo: number,
  extra: Partial<ChannelMessage> = {},
  /**
   * The thread this post belongs to, or `null` for a channel-level post.
   *
   * ⚠ **IT MERGES ONTO THE DERIVED MENTION SET, IT DOES NOT REPLACE IT.**
   * `metadata.threadId` is the only join between a message and its thread
   * (`view-model.ts › threadIdOf`), and `metadata` is also where the mention set lives.
   * Writing one over the other would silently un-pill every tag inside a thread.
   */
  threadId: string | null = null,
): { step: StepId; message: ChannelMessage } {
  seq += 1;
  /**
   * ⚠ **`extra.metadata` MERGES ONTO THE DERIVED KEYS, IT DOES NOT REPLACE THEM.** Three
   * independent things live in `metadata` now — the mention set, the thread join and the
   * device stamp — and `extra` is the one escape hatch every call site uses. Spreading
   * `extra` whole over the object (which is what it used to do) would let a caller adding
   * a device silently drop the mention set and the thread id, and the symptom would be a
   * pill quietly not rendering rather than an error.
   */
  const { metadata: extraMetadata, ...restExtra } = extra;
  return {
    step,
    message: {
      id: `demo-m${seq}`,
      seq,
      channelId: CHANNEL_ID,
      authorUserId,
      authorKind: "user",
      kind: "message",
      body,
      metadata: {
        ...mentionMetadata(body, authorUserId),
        ...(threadId === null ? {} : { threadId }),
        ...(extraMetadata ?? {}),
      },
      clientMsgId: null,
      createdAt: minsAgo(minutesAgo),
      authorName:
        MEMBERS.find((m) => m.userId === authorUserId)?.displayName ?? null,
      authorAvatarUrl: null,
      // ⚠ `restExtra`, NOT `extra`: `metadata` was pulled out above and merged.
      ...restExtra,
    },
  };
}

/**
 * **WHERE A MESSAGE WAS SENT FROM** (Samuel, 2026-10-12: human messages should show the
 * real "sent from" pill).
 *
 * ⚠ **THE PRODUCT'S OWN STAMP SHAPE, AND ITS OWN RENDERER.** `metadata.source` is parsed
 * by `lib/message-device.ts › messageSourceOf` and drawn by `transcript.tsx`'s
 * `DevicePill`, so nothing here is a look-alike: the fixture writes the stamp an HTTP
 * post or a glasses door would have written and the pill follows. `kind` is the closed
 * set from `server/message-source-stamp.ts`.
 *
 * ⚠ **AGENT POSTS GET NONE, AND THAT IS THE PRODUCT'S RULE NOT A CHOICE HERE**:
 * `view-model-rows.ts` sets `source: null` whenever `authorKind === "agent"`. So only the
 * four human lines in this scene can carry one, which is exactly the ask.
 */
const SOURCE = {
  graceMac: {
    kind: "computer",
    device_id: "demo-dev-grace",
    label: "Grace's MacBook Pro",
    platform: "macos",
  },
  anthonyPhone: {
    kind: "phone",
    device_id: "demo-dev-anthony",
    label: "Anthony's iPhone",
    platform: "ios",
  },
  samuelMac: {
    kind: "computer",
    device_id: "demo-dev-samuel",
    label: "Daniel's MacBook Pro",
    platform: "macos",
  },
  // He answers the orchestrator's question out loud while the private chat is open.
  samuelGlasses: {
    kind: "glasses",
    device_id: "demo-dev-g2",
    label: "Even G2",
    platform: "even_g2",
  },
} as const;

/** `extra` for a human post, carrying the device it was sent from. */
const from = (source: (typeof SOURCE)[keyof typeof SOURCE]) => ({
  metadata: { source },
});

/** An agent's post, stamped so `citedMessage` can read the author agent back off it. */
const agentPost = (agentId: string, n: number) => ({
  authorKind: "agent" as const,
  clientMsgId: `agent-${agentId}-${n}`,
});

/** A launch notice, which renders as a receipt row rather than a message. */
const systemLine = { kind: "system" as const, authorKind: "system" as const };

/**
 * **THE SCRIPT, AND THE ONE PLACE THE APPROVED WORDING LIVES.**
 *
 * Source: KB `codebase-cleanup` › "Landing Demo Script v3 (for Samuel)", approved
 * 2026-10-12. That entry is authoritative for wording; this array is its only
 * representation in the repo.
 *
 * ⚠ **NOTHING ELSE IN THIS DIRECTORY MAY RESTATE A LINE.** Two hand-maintained copies of
 * one string always separate, and this scene has already paid for that three times: the
 * mentions rows cited the wrong post, the inbound banner retyped the transcript, and the
 * two KB copies drifted three words apart within an hour of each other. So the inbound
 * lane and the mentions inbox DERIVE their text from here (`citedMessage`), and
 * `demo-script.test.ts` fails if any sibling module contains a copy of a line.
 *
 * ⚠ **SANITISED FOR A PUBLIC PAGE.** No real internal agent, file path or defect appears
 * here. The agent names use our naming STYLE; the product they work on is invented.
 */
const SCRIPT: ReadonlyArray<{ step: StepId; message: ChannelMessage }> = [
  // 1. The team notices the debt piling up.
  msg(
    "channel-base",
    U.grace,
    "ok we've got a pile of debt again. three things keep coming up",
    26,
    from(SOURCE.graceMac),
  ),
  msg(
    "channel-base",
    U.anthony,
    "the flaky tests mostly. i've rerun that suite four times today",
    24,
    from(SOURCE.anthonyPhone),
  ),
  msg(
    "channel-samuel",
    U.samuel,
    "yeah and session teardown is still open. let's actually clear some of it this week",
    7,
    from(SOURCE.samuelMac),
  ),
  // 2. Each person launches their own orchestrator.
  msg("launch-1", null, "Grace launched Debt Triage from an identity", 6, systemLine),
  msg("launch-2", null, "Daniel launched Cleanup Planner from an identity", 6, systemLine),
  msg("launch-3", null, "Anthony launched Backlog Scout from an identity", 6, systemLine),
  // 3. The orchestrators go and look at the stack.
  msg(
    "scout-1",
    U.grace,
    "Read the last two weeks of `#eng-help`. The flaky suite is the loudest complaint, **9 separate threads**. Upload retries timing out is second",
    5,
    agentPost(AGENT_IDS.triage, 1),
  ),
  msg(
    "scout-2",
    U.anthony,
    "Checked the knowledge base. *Session teardown* already has a write-up with a repro, and the upload retry path has a planned doc. Nothing written for the flakes",
    5,
    agentPost(AGENT_IDS.scout, 1),
  ),
  // 4. They split it between themselves. No human assigns anything from here to the
  //    private chat.
  msg(
    "split-1",
    U.samuel,
    "@debt-triage you have the most context on the suite, take the flakes. I'll take session teardown since the repro is already in our KB",
    4,
    agentPost(AGENT_IDS.planner, 1),
  ),
  msg(
    "split-2",
    U.grace,
    "Works for me. @backlog-scout upload retries are closest to what Anthony has been in all week. @Daniel teardown is yours",
    4,
    agentPost(AGENT_IDS.triage, 2),
  ),
  msg(
    "split-3",
    U.anthony,
    "Taking it. Opening a thread",
    3,
    agentPost(AGENT_IDS.scout, 2),
  ),
  // 5. Each opens its own thread. These openers ARE the thread cards: `channelRows`
  //    collapses each thread to its opener and the card's preview is this body.
  msg(
    "thread-1",
    U.grace,
    "Starting with the four that fail most often",
    3,
    agentPost(AGENT_IDS.triage, 3),
    THREAD_IDS.flakes,
  ),
  msg(
    "thread-2",
    U.samuel,
    "Three separate symptoms, splitting them out",
    3,
    agentPost(AGENT_IDS.planner, 2),
    THREAD_IDS.teardown,
  ),
  msg(
    "thread-3",
    U.anthony,
    "Reading the planned doc first",
    2,
    agentPost(AGENT_IDS.scout, 3),
    THREAD_IDS.uploads,
  ),
  // 6. Inside the thread: the orchestrator launches its coders and briefs each one.
  msg(
    "thread-launch-1",
    null,
    "Cleanup Planner launched Teardown Order Fix from an identity",
    2,
    systemLine,
    THREAD_IDS.teardown,
  ),
  msg(
    "thread-launch-2",
    null,
    "Cleanup Planner launched End Notice Check from an identity",
    2,
    systemLine,
    THREAD_IDS.teardown,
  ),
  msg(
    "thread-launch-3",
    null,
    "Cleanup Planner launched Wake Replay Trace from an identity",
    2,
    systemLine,
    THREAD_IDS.teardown,
  ),
  msg(
    "brief-1",
    U.samuel,
    "@teardown-order-fix the socket closes before teardown finishes. Start at `session/teardown.ts` and work out whether the final post ever goes out",
    2,
    agentPost(AGENT_IDS.planner, 3),
    THREAD_IDS.teardown,
  ),
  msg(
    "brief-2",
    U.samuel,
    "@end-notice-check a session that ends mid-run never writes its closing record. Check what `history.ts` actually wrote",
    2,
    agentPost(AGENT_IDS.planner, 4),
    THREAD_IDS.teardown,
  ),
  msg(
    "brief-3",
    U.samuel,
    "@wake-replay-trace paused sessions might replay an old message when they resume. `boot.ts` never records where they left off",
    1,
    agentPost(AGENT_IDS.planner, 5),
    THREAD_IDS.teardown,
  ),
  msg(
    "coder-ack",
    U.samuel,
    "On it. Reading `session/teardown.ts` now",
    1,
    agentPost(AGENT_IDS.teardown, 1),
    THREAD_IDS.teardown,
  ),
  // 8. The channel keeps moving while the private chat runs. Channel-level on purpose:
  //    these are what the reader sees once the cursor walks back out through the crumb.
  msg(
    "concurrent-1",
    U.grace,
    "@backlog-scout the flakes and the retry path share a fixture. I'll leave `tests/fixtures/session.ts` alone so you don't get conflicts",
    1,
    agentPost(AGENT_IDS.triage, 4),
  ),
  msg(
    "concurrent-2",
    U.anthony,
    "Noted, thanks",
    1,
    agentPost(AGENT_IDS.scout, 4),
  ),
  msg(
    "concurrent-3",
    U.grace,
    "@Daniel do you want the flake fix behind a flag or straight in?",
    0,
    agentPost(AGENT_IDS.triage, 5),
  ),
  msg(
    "concurrent-4",
    U.samuel,
    "straight in. it's test only",
    0,
    from(SOURCE.samuelGlasses),
  ),
];

export function messagesAt(step: number): ChannelMessage[] {
  return SCRIPT.filter((s) => reached(step, s.step)).map((s) => s.message);
}

/**
 * The HUMAN post landing ON this beat, if any — the one the scene types out
 * word by word (`typed-reveal.ts`). Agent and system posts arrive whole.
 */
export function typedMessageAt(step: number): ChannelMessage | null {
  const hit = SCRIPT.find(
    (s) =>
      at(step, s.step) &&
      s.message.authorKind === "user" &&
      s.message.kind === "message",
  );
  return hit?.message ?? null;
}

/**
 * **THE THREADS THAT EXIST AT THIS BEAT.**
 *
 * ⚠ Gated on the step its OPENER lands, read off the script rather than authored, so a
 * thread cannot appear before the post that created it. `channelRows` needs the thread
 * row AND the tagged message to draw a card, so an ungated list would have shown three
 * cards from the first frame with nothing in them.
 */
export function threadsAt(step: number): ChannelThread[] {
  const open = new Set(
    SCRIPT.filter((s) => reached(step, s.step))
      .map((s) => threadIdOfMessage(s.message))
      .filter((id): id is string => id !== null),
  );
  return THREADS.filter((t) => open.has(t.id));
}

/** `view-model.ts › threadIdOf`'s rule, applied to our own fixtures. */
function threadIdOfMessage(message: ChannelMessage): string | null {
  const value = message.metadata?.threadId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * **ONE SCRIPTED POST, WITH THE BEAT IT LANDS ON** — for the fixtures that must point AT
 * a message rather than restate it (`demo-info-data.ts`'s mentions inbox).
 *
 * ⚠ **IT THROWS ON A MISS, AND THAT IS THE WHOLE POINT.** The mentions rows hand-authored
 * their own `seq`, `authorUserId`, `authorName` and `createdAt`, and two of the three had
 * DRIFTED off the messages they cite: the row quoting the analyst's line was keyed to
 * `demo-m9`, which is the writer's post, and the row quoting Anthony's CRM line was
 * attributed to Grace. Nothing rendered wrong because the list prints its own copy of
 * those fields, which is exactly how a fixture rots unnoticed. Deriving them from the
 * script means a renumbered or reworded post fails HERE instead.
 */
function scripted(id: string): { step: StepId; message: ChannelMessage } {
  const found = SCRIPT.find((s) => s.message.id === id);
  if (!found) {
    throw new Error(`banner demo: no scripted message ${id}`);
  }
  return found;
}

/** The post a fixture cites, and the beat it arrives on, so the two reveal together. */
export function citedMessage(id: string): {
  step: StepId;
  message: ChannelMessage;
  /** The authoring agent's colour, or `null` for a post a member wrote themselves. */
  agentColor: AgentColorKey | null;
  /** The authoring agent's id, read off `clientMsgId` as `agentPost` stamps it. */
  agentId: string | null;
} {
  const { step, message } = scripted(id);
  const agentId =
    message.authorKind === "agent" && message.clientMsgId
      ? (message.clientMsgId.split("-")[1] ?? null)
      : null;
  return {
    step,
    message,
    agentId,
    agentColor:
      agentId === null
        ? null
        : (AGENT_COLORS[agentId as keyof typeof AGENT_COLORS] ?? null),
  };
}

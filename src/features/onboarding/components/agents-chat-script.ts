import { splitWords } from "@/shared/ui/chat-reveal";

/**
 * Step 3's glass-card chat, the SCRIPT half: who is in the channel, what they
 * say, and the frame-by-frame timeline that plays it. Pure data + one pure
 * builder, no React. Presentation is `./agents-chat-transcript.tsx`; the clock
 * and layout `./agents-showcase.tsx`.
 *
 * The story (Samuel 2026-10-13, "Handle my inbox before vacation"): an
 * Orchestrator asks what it can take off your plate, you hand it the inbox and
 * the calendar, it launches three agents, briefs each in ONE message, they
 * work (coloured pills at the bottom) and each posts back with specifics.
 * Messages only — the landing channel demo's rows without its chrome.
 */

export type CastId = "you" | "orch" | "inbox" | "reply" | "cal";
/** Which image an avatar wears; resolved to a URL by the showcase. */
export type CastFace = "you" | "claude" | "chatgpt" | "muse";

export interface CastMember {
  name: string;
  face: CastFace;
  /** Agent colour-bank slot (`--agent-color-NN`); people have none. */
  color: number | null;
}

/** Colours are spread round the bank's hue wheel so no two read alike. */
export const CAST: Record<CastId, CastMember> = {
  you: { name: "You", face: "you", color: null },
  orch: { name: "Orchestrator", face: "claude", color: 3 },
  inbox: { name: "Inbox Sorter", face: "chatgpt", color: 7 },
  reply: { name: "Reply Writer", face: "muse", color: 11 },
  cal: { name: "Calendar Agent", face: "chatgpt", color: 14 },
};

/** A run of words; a `mention` run renders as the agent's @-tag. */
export interface Part {
  text: string;
  mention?: CastId;
}

export type ChatItem =
  | { kind: "msg"; who: CastId; parts: Part[] }
  /** A launch receipt: centred muted line, appears whole (as on the landing). */
  | { kind: "system"; text: string; starts?: CastId }
  /** Not drawn: the agents named start working (pills at the bottom). */
  | { kind: "work"; who: CastId[] };

const say = (who: CastId, text: string): ChatItem => ({ kind: "msg", who, parts: [{ text }] });
const launch = (who: CastId): ChatItem => ({
  kind: "system",
  text: `Orchestrator launched ${CAST[who].name}`,
  starts: who,
});

export const SCRIPT: ChatItem[] = [
  say("orch", "Hey! What can I take off your plate today?"),
  say("you", "I'm on vacation from Friday. Clear my inbox and move my meetings."),
  launch("inbox"),
  launch("reply"),
  launch("cal"),
  {
    kind: "msg",
    who: "orch",
    parts: [
      { text: "@Inbox Sorter", mention: "inbox" },
      { text: "sort all 38 unread into Needs you, Bills, Travel and Newsletters." },
      { text: "@Reply Writer", mention: "reply" },
      { text: "draft replies for everything in Needs you." },
      { text: "@Calendar Agent", mention: "cal" },
      { text: "move Thursday and Friday to next week and let people know." },
    ],
  },
  { kind: "work", who: ["inbox", "reply", "cal"] },
  say("inbox", "Done: 6 Needs you, 9 Bills & receipts, 4 Travel, 19 Newsletters archived."),
  say(
    "reply",
    "Drafted 6 replies: landlord re lease renewal, Dr. Patel re moving your cleaning, Maya re Thursday dinner, and 3 more."
  ),
  say("cal", "Moved 1:1 with Jordan, book club and your haircut to Mon–Tue. Everyone's been notified."),
  say("orch", "All set. 6 drafts are waiting for your review before Friday."),
];

/** A message's words, each tagged with the mention it belongs to (if any). */
export function tokens(parts: Part[]): { w: string; mention?: CastId }[] {
  return parts.flatMap((p) =>
    splitWords(p.text).map((w) => ({ w, mention: p.mention }))
  );
}

/**
 * One state of the card. Items `[0, count)` are on screen, all whole but the
 * last, which shows `words` words. `working` = agents with a pill up.
 */
export interface AgentsFrame {
  at: number;
  count: number;
  words: number;
  working: CastId[];
  clearing: boolean;
}

export const PACE = {
  start: 500,
  userWord: 80,
  agentWord: 55,
  beforeMsg: 900,
  beforeLaunch: 450,
  /** Between replies: the agents are working, pills up. */
  workBefore: [2200, 1500, 1400],
  hold: 3200,
  clear: 450,
} as const;

/** Every frame of one loop, and the loop's length. */
export function buildAgentsTimeline(script: ChatItem[] = SCRIPT): {
  frames: AgentsFrame[];
  cycle: number;
} {
  const frames: AgentsFrame[] = [];
  let t = 0;
  let working: CastId[] = [];
  let replies = 0;
  const push = (count: number, words: number, clearing = false) =>
    frames.push({ at: t, count, words, working, clearing });
  push(0, 0);
  t += PACE.start;
  script.forEach((item, i) => {
    const count = i + 1;
    if (item.kind === "system") {
      t += PACE.beforeLaunch;
      push(count, 0);
      return;
    }
    if (item.kind === "work") {
      t += 350;
      working = [...item.who];
      push(count, 0);
      return;
    }
    // A working agent's pill drops the moment it starts posting.
    if (working.includes(item.who)) {
      t += PACE.workBefore[replies++] ?? PACE.beforeMsg;
      working = working.filter((w) => w !== item.who);
    } else if (i > 0) {
      t += PACE.beforeMsg;
    }
    const per = item.who === "you" ? PACE.userWord : PACE.agentWord;
    tokens(item.parts).forEach((_, k) => {
      push(count, k + 1);
      t += per;
    });
  });
  t += PACE.hold;
  push(script.length, finalWords(script), true);
  t += PACE.clear;
  return { frames, cycle: t };
}

function finalWords(script: ChatItem[]): number {
  const last = script[script.length - 1];
  return last.kind === "msg" ? tokens(last.parts).length : 0;
}

/** Reduced motion: the whole story, finished, no pills. */
export function agentsFinalFrame(script: ChatItem[] = SCRIPT): AgentsFrame {
  return { at: 0, count: script.length, words: finalWords(script), working: [], clearing: false };
}

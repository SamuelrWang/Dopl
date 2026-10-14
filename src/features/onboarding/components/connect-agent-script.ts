/**
 * Step 2's glass-card showcase, the SCRIPT half: what the two agents say and
 * the frame-by-frame timeline that plays it. Pure data + one pure builder, no
 * React, so the timing is testable without a clock. Presentation lives in
 * `./connect-agent-transcript.tsx`; the clock and layout in
 * `./connect-agent-showcase.tsx`.
 *
 * Two segments (Samuel 2026-10-13): Claude, then Gemini, each two turns, each
 * reaching for DIFFERENT Dopl tools — the point being one workspace behind
 * any agent. Tool labels are Dopl's real MCP names (`dopl_search` →
 * "Dopl search"), never invented ones.
 */

export type AgentLogo = "claude" | "gemini";

export type ScriptMsg =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  /** A Dopl MCP call. `label` is the tool's real name, humanised; `arg` the
   *  one argument worth showing, rendered lighter. */
  | { kind: "tool"; label: string; arg: string };

export interface ScriptSegment {
  logo: AgentLogo;
  name: string;
  msgs: ScriptMsg[];
}

export const SEGMENTS: ScriptSegment[] = [
  {
    logo: "claude",
    name: "Claude",
    msgs: [
      { kind: "user", text: "What did we decide on pricing?" },
      { kind: "agent", text: "Checking the team's knowledge base." },
      { kind: "tool", label: "Dopl search", arg: "pricing decision" },
      { kind: "tool", label: "Dopl read entry", arg: "Pricing v2" },
      { kind: "agent", text: "Usage-based tiers, starting at $9 a month." },
      { kind: "user", text: "Add that to the launch notes." },
      { kind: "tool", label: "Dopl write entry", arg: "Launch notes" },
      { kind: "agent", text: "Done — the team will see it there." },
    ],
  },
  {
    logo: "gemini",
    name: "Gemini",
    msgs: [
      { kind: "user", text: "Anything new in #design today?" },
      { kind: "tool", label: "Dopl read channel", arg: "#design" },
      { kind: "agent", text: "The new logo is final. Ana wants feedback by Friday." },
      { kind: "user", text: "Tell her I'll review it Thursday." },
      { kind: "tool", label: "Dopl send message", arg: "#design" },
      { kind: "agent", text: "Sent. Ana has it in #design." },
    ],
  },
];

/**
 * One state of the card. Messages `[0, count)` are on screen; all but the
 * last are whole. The last shows `words` words — or, for a tool row, `0` =
 * running and `1` = settled.
 */
export interface ChatFrame {
  /** ms from the cycle's start. */
  at: number;
  seg: number;
  count: number;
  words: number;
  /** The transcript is fading out before the agent swaps. */
  clearing: boolean;
}

/** Pacing, ms. Typewriter by WORD: users type a touch slower than agents
 *  stream; tools hold their running state long enough to read. */
export const PACE = {
  logoSettle: 650,
  userWord: 85,
  agentWord: 62,
  beforeUser: 1000,
  beforeAgent: 520,
  beforeTool: 380,
  toolRun: 1050,
  hold: 2400,
  clear: 420,
} as const;

export const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** Every frame of one full Claude → Gemini cycle, and the cycle's length. */
export function buildTimeline(segments: ScriptSegment[] = SEGMENTS): {
  frames: ChatFrame[];
  cycle: number;
} {
  const frames: ChatFrame[] = [];
  let t = 0;
  segments.forEach((segment, seg) => {
    const push = (count: number, w: number, clearing = false) =>
      frames.push({ at: t, seg, count, words: w, clearing });
    push(0, 0);
    t += PACE.logoSettle;
    segment.msgs.forEach((msg, i) => {
      const count = i + 1;
      if (msg.kind === "tool") {
        t += PACE.beforeTool;
        push(count, 0);
        t += PACE.toolRun;
        push(count, 1);
        return;
      }
      t += msg.kind === "user" ? (i === 0 ? 0 : PACE.beforeUser) : PACE.beforeAgent;
      const per = msg.kind === "user" ? PACE.userWord : PACE.agentWord;
      words(msg.text).forEach((_, k) => {
        push(count, k + 1);
        t += per;
      });
    });
    t += PACE.hold;
    const last = segment.msgs[segment.msgs.length - 1];
    push(segment.msgs.length, last.kind === "tool" ? 1 : words(last.text).length, true);
    t += PACE.clear;
  });
  return { frames, cycle: t };
}

/** Reduced motion: segment 1, finished, nothing moving. */
export function finalFrame(seg = 0, segments: ScriptSegment[] = SEGMENTS): ChatFrame {
  const msgs = segments[seg].msgs;
  const last = msgs[msgs.length - 1];
  return {
    at: 0,
    seg,
    count: msgs.length,
    words: last.kind === "tool" ? 1 : words(last.text).length,
    clearing: false,
  };
}

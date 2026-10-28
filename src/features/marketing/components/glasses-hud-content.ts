/** The conversation the Devices band's glasses card plays (glasses-hud.tsx).
 *  Edit here only.
 *
 *  Laid out like the G2 plugin's Conversation screen
 *  (~/Downloads/glasses-mcp/plugin/src/core/nav/screens/stream.ts, 2026-10-15):
 *  a header `<Agent> - <Model> | Channel: <Channel>` (stream.ts › header), one
 *  page of messages, and a footer. The plugin's footer row reads
 *  `● Message Agent`, then `● Listening... tap to send` while the mic is open,
 *  then `● Sending...`, and the chat shows `You: (Sending...)` → `You: <transcript>
 *  (Sent)` (stream.ts › the voice label; src/core/nav/reader.ts). Here the
 *  footer is a mic icon instead (Samuel, 2026-10-16), and the transcript types
 *  in live beside it before it posts — a staging of what the lens does.
 *  Messages read `You: … (Sent)` / `<Agent>: …` (plugin README › Navigation).
 *  The chart is a custom screen an agent draws with glasses_render
 *  (src/features/glasses/core/mcp/tools.ts); the meeting card is a
 *  glasses_notify.
 *
 *  The story (Samuel, 2026-10-22): Pitch Partner, one of the user's standing
 *  identities (a role, not a one-off task), preps them on the way into a pitch:
 *  it reads revenue and pipeline, puts the numbers on the lens as a chart and
 *  answers follow-ups out loud. Figures are illustrative.
 *
 *  ⚠ Lens glyphs: ASCII plus box drawing / geometric shapes only (▶ ● ─ ▮).
 *  No `·`, `›`, `—` — the G2 font cannot draw them (plugin README). */

export interface HudLine {
  readonly text: string;
  /** `dim` = meta line (a tool the identity used). */
  readonly tone?: "dim";
  /** Types in word by word (at most one per step). */
  readonly type?: boolean;
}

/** A custom lens screen: a headline over a few bars, drawn in lens green. */
export interface HudChart {
  readonly headline: string;
  readonly bars: readonly { readonly label: string; readonly value: number }[];
}

/**
 * One beat of the feed, applied in order:
 * - `connect` links the glasses: the connect pill reveals HUD_CONNECTION's
 *   functions one chip at a time (device-connect.tsx);
 * - `voice` opens the mic and types `text` into the footer (nothing posts yet);
 * - `message` appends lines at the bottom (older lines slide up);
 * - `chart` appends a custom screen whose bars rise one at a time.
 * `hold` = how long the finished beat stays before the next, ms.
 */
export type HudStep =
  | { readonly kind: "connect"; readonly hold: number }
  | { readonly kind: "voice"; readonly text: string; readonly hold: number }
  | { readonly kind: "message"; readonly id: string; readonly lines: readonly HudLine[]; readonly hold: number }
  | { readonly kind: "chart"; readonly id: string; readonly chart: HudChart; readonly hold: number };

/** The lens header, in the plugin's format `<Agent> - <Model> | Channel:
 *  <Channel>` (stream.ts › header): the identity, its model, and the channel
 *  it posts from (Samuel, 2026-10-23). ASCII only (see the glyph rule above). */
export const HUD_HEADER = "Pitch Partner - Opus | Channel: Sales";

/** What connecting the G2 hands to the identity, as Dopl's glasses tools use
 *  it: the lens (glasses_show / glasses_render / glasses_notify), the
 *  microphone (push-to-talk voice) and touch (glasses_ask waits for a tap).
 *  ⚠ The G2 has no camera and no speaker, so neither is listed. */
export const HUD_CONNECTION = {
  device: "Even Realities G2",
  takeover: "Pitch Partner is now on your lens.",
  functions: ["display", "mic", "touch"],
} as const;

/** Chip cadence for the connect pill, ms. */
export const HUD_CONNECT_MS = 280;

export const HUD_FEED: readonly HudStep[] = [
  { kind: "connect", hold: 700 },
  { kind: "voice", text: "Heading into the Acme pitch. Give me our numbers.", hold: 600 },
  {
    kind: "message",
    id: "ask-numbers",
    hold: 700,
    lines: [{ text: "You: Heading into the Acme pitch. Give me our numbers. (Sent)" }],
  },
  { kind: "message", id: "stripe", hold: 650, lines: [{ text: "◆ Stripe: read revenue", tone: "dim" }] },
  { kind: "message", id: "sheets", hold: 650, lines: [{ text: "◆ Sheets: read pipeline", tone: "dim" }] },
  {
    kind: "chart",
    id: "mrr",
    hold: 2600,
    chart: {
      headline: "MRR $48.2k | +18% QoQ",
      bars: [
        { label: "M", value: 31 },
        { label: "J", value: 34 },
        { label: "J", value: 37 },
        { label: "A", value: 41 },
        { label: "S", value: 44 },
        { label: "O", value: 48.2 },
      ],
    },
  },
  { kind: "voice", text: "What's our churn?", hold: 550 },
  { kind: "message", id: "ask-churn", hold: 600, lines: [{ text: "You: What's our churn? (Sent)" }] },
  {
    kind: "message",
    id: "churn",
    hold: 1800,
    lines: [{ text: "Pitch Partner: 2.1% monthly, down from 3.4% in Q2.", type: true }],
  },
  {
    kind: "message",
    id: "meeting",
    hold: 2600,
    lines: [{ text: "Acme pitch starts in 2 min" }, { text: "Conference room B", tone: "dim" }],
  },
];

/** Word cadence for an agent's typed line, ms. */
export const HUD_WORD_MS = 110;

/** Word cadence for live dictation in the footer, ms. Slower, like speech. */
export const HUD_VOICE_WORD_MS = 190;

/** Bar cadence for a chart rising, ms. */
export const HUD_BAR_MS = 140;

/** Fade-out before the feed restarts from the top, ms (matches glasses-hud.css). */
export const HUD_LOOP_FADE_MS = 450;

"use client";

/**
 * **WHAT WOKE IT** — the message that ARRIVED for this agent, at the place in its stream where it
 * landed (Samuel, 2026-10-10, #3081: the agent view showed the outbound *"posted to Dopl channel"*
 * boxes and the agent working, and nothing at all about the message it was answering).
 *
 * ⚠ WHAT IT REPLACES: nothing. There was no frame on the wire for an arriving channel message —
 * `inbound_arrived` reached `main/session-narration.js › note` and `entryFor` had no arm for it — so
 * the operator read one side of every exchange and had to infer the other from the agent's reply.
 * The frame is new (that file's `inbound` arm and `› noteLaunchMessage`); this is its face.
 *
 * ── THE DESIGN FAMILY, AND THE ONE THING IT MAY NOT BORROW ──────────────────────────────────────
 *
 * ⚠ IT IS `agent-stream-sent-box.tsx`'s BOX, by the same argument `agent-stream-directed.tsx` makes
 * for being one: full stream width rather than a chat bubble, radius 12, a banner over a body, the
 * timestamp riding in the banner's trailing tag. That geometry is what says *this is an EXCHANGE,
 * not a line of the log*, and this box and the sent box are the two halves of the same exchange.
 *
 * ⚠ **AND IT MAY NOT WEAR THE DARK CTA BANNER, WHICH IS THE POINT OF THE PAIR.** `--surface-cta` on
 * the sent box means ONE thing on this surface: *these words left the machine and the counterparty
 * has them* (INVARIANTS §11), and the agent's own colour on it means *this is in the channel,
 * attributed to me*. An arriving message is the opposite claim on both counts — somebody else wrote
 * it and it came IN — so the banner here is the inset ground the panel's quiet chrome already uses,
 * exactly as the directed lane's is. **Same box, different weight**: the box says two parties
 * exchanged something, the weight says which way it travelled and who can see it.
 *
 * ⚠ **IT IS THE DIRECTED BOX'S WEIGHT WITHOUT BEING THE DIRECTED BOX.** The two look alike because
 * both are messages this agent RECEIVED; they are not one component because they are not one fact,
 * and the copy is where that shows. A direction is 1:1 between two of the operator's OWN agents over
 * a mailbox no peer can read (`agent-stream-directed.tsx`'s header), so its label may only ever name
 * the relation — *"your agent"*. This message is in the CHANNEL, it can come from any member, and
 * main resolves its sender, so this label can and does name the sender. Fusing them would force the
 * weaker claim onto both.
 */

import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import { agentColorVar } from "../lib/agent-colors";
import { agentNameHandle } from "../lib/agent-mentions";
import type { AgentColorKey } from "../types";
import { StreamProse } from "./agent-stream-prose";

/**
 * WHAT THE BANNER SAYS. ⚠ Exported for the tests, on the sent box's rule: this wording and
 * {@link postedToLabel}'s over the same geometry are opposite claims about WHICH WAY the words
 * travelled, and getting them the wrong way round is this card's version of saying a private steer
 * was posted.
 *
 * ⚠ **THE NAMELESS FORM IS A COMPLETE SENTENCE, NOT A GAP.** It says the fact the frame guarantees
 * — a message arrived for this agent — and nothing it cannot support. An older main stamps no
 * sender, and `main/session-dispatch.js › authorLabel` has its own *"A teammate"* fallback, so the
 * absence is ordinary rather than a failure to report.
 * ⚠ **NO EM DASHES, NO INVENTED CERTAINTY** (Dopl copy voice). "Message received from X" is what
 * happened; "X says" would put words in a member's mouth, and "New message" would claim a recency
 * this row does not have once it has scrolled.
 */
export const INBOUND_ANON_LABEL = "Message received";

/**
 * 🔴 **WHEN IT CAME FROM THE OPERATOR'S OWN ACCOUNT, THE FACE SAYS "you"** (release
 * review, 2026-10-11).
 *
 * ⚠ **THE FLAG WAS ON THE WIRE AND ON THE ITEM AND THEN DROPPED.** Main stamps
 * `fromOperator` *"so the face can say 'you' where it is the operator's own channel
 * post"* (`spa-bridge-narration.ts`), `agent-stream-model.ts` carries it onto the
 * item lane-gated — and the renderer never read it, so the operator's own post read
 * back at them as **"Message received from Sam Wang"**: their own display name,
 * captioned as if a counterparty had written it.
 * ⚠ **IT IS STILL NOT A PRIVACY CLAIM AND IT DOES NOT MOVE THE LANE.** The message is
 * in the channel either way; what changes is the one word naming who wrote it.
 * ⚠ **IT OUTRANKS THE RESOLVED NAME, because the name is the LESS specific fact.**
 * Main's `authorLabel` answers a display name or *"<person>'s agent"* — and ruling 2
 * (2026-09-25) folds the operator's OWN agents into this flag, so `fromOperator` with
 * a name attached is still the operator's account speaking. Naming it twice over
 * would print the viewer's own name at them, which is what this closes.
 */
export const INBOUND_OPERATOR_LABEL = "Message received from you";

/**
 * 🔴 **"you" IS NOW ONLY FOR WORDS THE OPERATOR TYPED — THEIR OWN AGENTS ARE NAMED AS AGENTS**
 * (Samuel, 2026-10-12; INVARIANTS §11).
 *
 * ⚠ **THIS NARROWS RULING 2 (2026-09-25) FOR THIS BANNER AND FOR NOTHING ELSE.** That ruling folds
 * the operator's own agents into `fromOperator`, and it is still the right answer to the question
 * it answers — *whose ACCOUNT spoke* — which is why the flag is unchanged everywhere it gates. It
 * was the wrong answer to the question THIS line asks, *who wrote it*: an orchestrator of the
 * operator's own posting into the room read back as **"Message received from you"**, so the
 * operator was shown their own name over words a machine of theirs had written.
 * ⚠ **`authorKind` DECIDES, AND IT IS SERVER-DERIVED FROM THE AUTHOR'S CREDENTIAL**
 * (`StreamItem.authorKind`). The one other way to tell an agent apart here is to look for
 * *"'s agent"* inside {@link InboundBox}'s `sender` — already-resolved PEER PROSE — which would
 * let a display name somebody typed decide how this card is painted. Never derived from prose.
 * ⚠ **AN AGENT IS NAMED BY ITS OWN HANDLE, NOT BY ITS OPERATOR**: `@cleanup-orchestrator` rather
 * than *"Sam Wang's agent"*, because that is the name everybody in the room uses for it and the
 * form they address it by. The slug is {@link mentionSlug}'s — the SAME one the picker inserts and
 * the mention resolver accepts — so the banner cannot spell a handle a reader could not retype.
 * ⚠ **AND IT DEGRADES THROUGH THE FACTS IT HAS**: no agent name ⇒ the resolved label
 * (*"<person>'s agent"*, which is still true), no label either ⇒ {@link INBOUND_ANON_LABEL}.
 * Never a blank, and never an id.
 */
export function inboundLabel(
  sender: string | null | undefined,
  fromOperator?: boolean,
  authorKind?: "user" | "agent",
  senderAgentName?: string | null
): string {
  const name = typeof sender === "string" ? sender.trim() : "";
  if (authorKind === "agent") {
    const agent = typeof senderAgentName === "string" ? senderAgentName.trim() : "";
    const handle = agentNameHandle(agent);
    if (handle) return `Message received from @${handle}`;
    // ⚠ A NAME THE STRIP WOULD EAT STILL NAMES SOMEBODY — print it as given rather than as a
    // handle no reader could retype. That is `agent-mentions.ts › agentNameHandle`'s documented
    // `null`, and the same obligation `agentMentionFace`'s callers already carry.
    if (agent) return `Message received from ${agent}`;
    return name ? `Message received from ${name}` : INBOUND_ANON_LABEL;
  }
  // ⚠ ONLY REACHED FOR A HUMAN OR AN UNKNOWN KIND, and that ORDER is the ruling: an own agent is
  // handled above and can no longer claim this sentence.
  if (fromOperator === true) return INBOUND_OPERATOR_LABEL;
  return name ? `Message received from ${name}` : INBOUND_ANON_LABEL;
}

/**
 * **WHO WROTE IT, AS A WEIGHT** (Samuel, 2026-10-12): a HUMAN member's message wears the black
 * banner and a black edge; an AGENT's wears that agent's own identity colour.
 *
 * ⚠ **BLACK IS `--surface-cta`, WHICH IS THE ONE BLACK THIS TREE HAS** (docs/DESIGN-SYSTEM.md —
 * no hardcoded hex in a component; `globals.css` defines `--black` as an alias OF it). The ink is
 * `text-on-cta`, the pair the sent box has shipped on the same geometry, so the contrast decision
 * is BORROWED rather than made a second time here.
 * ⚠ **AND THE PAIR IS WHY AN AGENT'S COLOUR CAN REUSE THAT INK**: every one of the sixteen keys is
 * a dark ramp (`agent-stream-sent-box.tsx › BANNER_PILL` measured it at L 0.44), which is exactly
 * what lets one ink serve the black face and all sixteen hues — the agent BADGE's own decision.
 * ⚠ **NO DARK-MODE ARM, BECAUSE THERE IS NO DARK MODE** (measured 2026-10-12): neither
 * `src/app/globals.css` nor `apps/desktop-ui/src/styles/tokens.css` carries a `.dark`,
 * `[data-theme]` or `prefers-color-scheme` block, so `--surface-cta` resolves to one value and
 * black cannot vanish into the ground. The day a dark theme lands, this is a token question
 * (what `--surface-cta` resolves to there), not a branch in this file.
 * ⚠ **`null` IS THE NEUTRAL FACE AND IT IS LOAD-BEARING** — the inset banner this card has always
 * worn, kept byte-identical for an unknown author kind and for an agent whose colour did not
 * resolve. A card that cannot say who wrote it must not claim a human wrote it.
 */
type InboundPaint = { fill: string; onFill: true } | null;

/**
 * ONE ARRIVING CHANNEL MESSAGE.
 *
 * ⚠ THE BODY GOES THROUGH `StreamProse` LIKE EVERY OTHER MESSAGE FACE. It is prose a member wrote
 * for this agent to read, it is the same string the message pane one view over renders as markdown,
 * and a message that read as formatted in the channel and as raw asterisks here would be one
 * message wearing two faces.
 */
export function InboundBox({
  text,
  sender,
  fromOperator,
  authorKind,
  senderAgentName,
  senderColor = null,
  at,
}: {
  text: string;
  /**
   * WHO SENT IT, **already resolved to words by main** — a display name, *"<person>'s agent"*, or
   * its own fallback (`main/session-dispatch.js › authorLabel`).
   *
   * 🔒 **PEER-TYPED AND UNVERIFIED.** Nothing gates on it, and it is NEUTRALIZED HERE THE WAY EVERY
   * OTHER NAME IN THIS TREE IS: rendered as a React TEXT CHILD on a single `truncate` line, so a
   * name carrying markup cannot render and one carrying newlines cannot forge a second banner row.
   * ⚠ `null` renders {@link INBOUND_ANON_LABEL} — never a blank, and never an id.
   */
  sender?: string | null;
  /** THE OPERATOR'S OWN ACCOUNT SENT IT (`StreamItem.fromOperator`) — only `true` counts, and
   *  it names the sender "you" instead, **unless an agent of theirs wrote it** (2026-10-12).
   *  See {@link INBOUND_OPERATOR_LABEL} and {@link inboundLabel}. */
  fromOperator?: boolean;
  /**
   * **WHAT KIND OF AUTHOR WROTE IT** (`StreamItem.authorKind`, server-derived from their
   * credential): `"user"` paints the black face, `"agent"` paints that agent's colour.
   *
   * ⚠ ABSENT IS UNKNOWN AND PAINTS NOTHING — see {@link InboundPaint}. It is also what every
   * frame from an older main carries, so this card degrades to exactly its previous face.
   */
  authorKind?: "user" | "agent";
  /** The agent's own name when `authorKind` is `"agent"` — the banner names `@the-agent` with it
   *  ({@link inboundLabel}). ⚠ Peer-typed; neutralized as a text child like `sender`. */
  senderAgentName?: string | null;
  /**
   * **THE SENDING AGENT'S IDENTITY COLOUR** — the key its banner and edge are painted with
   * (Samuel, 2026-10-12; `StreamItem.senderColor`, already narrowed to one of the sixteen).
   *
   * ⚠ **IT IS THE COLOUR THE READER HAS ALREADY BEEN TAUGHT**: the same key that agent's avatar,
   * its transcript accent and its own posted banner wear (docs/specs/agent-colors.md item 5), so
   * the card answers *which* agent wrote this without the reader parsing the label.
   * ⚠ **`null` IS THE NEUTRAL FACE, NOT BLACK.** An uncoloured agent is legitimate — a
   * seventeenth live agent in one room has no key — and black belongs to a HUMAN author here.
   * ⚠ **THE PAINT ROUTE IS `lib/agent-colors.ts › agentColorVar` AND THERE IS NO SECOND ONE.**
   */
  senderColor?: AgentColorKey | null;
  /** Epoch ms. `0` means the stamp was unreadable: the tag drops rather than printing an epoch date
   *  at somebody (the sent box's rule). */
  at?: number;
}) {
  const stamp = at ? formatChannelTimestamp(new Date(at).toISOString()) : "";
  /* ⚠ **THE KIND DECIDES THE WEIGHT, AND ONLY A KNOWN KIND DECIDES ANYTHING.** A human's message
     is the one arriving fact in this column that a PERSON authored, which is what the black face
     says; an agent's wears the colour that agent already wears everywhere else. Everything else —
     an unknown kind, an agent with no key — keeps the neutral inset banner.
     ⚠ **AN AGENT IS NEVER PAINTED BLACK AS A FALLBACK.** Black is this surface's claim that a
     PERSON wrote the words, so a colourless agent degrades to neutral rather than borrowing it. */
  const paint: InboundPaint =
    authorKind === "user"
      ? { fill: "var(--surface-cta)", onFill: true }
      : authorKind === "agent" && senderColor
        ? { fill: agentColorVar(senderColor), onFill: true }
        : null;
  return (
    <div
      /* ⚠ THE FULLER BORDER, LIKE THE INBOUND DIRECTED BOX AND FOR ITS REASON: within an
         exchange, the arriving box is the one carrying a fact the operator did not already have —
         somebody else's words reached their agent — and this column is otherwise full of their own
         agent speaking.
         ⚠ **THE EDGE IS PAINTED WITH THE BANNER OR NOT AT ALL** (Samuel, 2026-10-12: *the banner
         fill is BLACK and the card's border line is BLACK*). One `style`, two properties, so a
         card can never wear one author's weight on its banner and another on its edge. */
      className="min-w-0 overflow-hidden rounded-[12px] border border-border-default bg-card-surface-subtle"
      style={paint ? { borderColor: paint.fill } : undefined}
      data-stream-inbound
      /* The test vocabulary for "which weight did this card draw" — read, never styled on. */
      data-stream-inbound-paint={
        paint ? (authorKind === "agent" ? "agent" : "human") : "neutral"
      }
    >
      {/* ⚠ THE INSET FILL STAYS A CLASS AND THE AUTHOR'S FILL ARRIVES AS AN INLINE `style`, the
          sent box's arrangement exactly: the unpainted face is byte-identical to what shipped
          before this wave, and a `var()` cannot be built into a Tailwind class from a runtime
          value without sixteen literals or a safelist (`lib/agent-colors.ts`). */}
      <div
        className={cn("flex items-center gap-1.5 px-2.5 py-[5px]", !paint && "bg-bg-inset")}
        style={paint ? { backgroundColor: paint.fill } : undefined}
      >
        <span
          className={cn(
            "min-w-0 truncate text-micro font-medium",
            paint ? "text-text-on-cta" : "text-text-secondary"
          )}
        >
          {inboundLabel(sender, fromOperator, authorKind, senderAgentName)}
        </span>
        {stamp && (
          <span
            className={cn(
              "ml-auto shrink-0 text-micro",
              /* ⚠ THE SENT BANNER'S OWN PAIRING for a stamp riding a dark fill — one ink, dimmed,
                 rather than a second colour token per face. */
              paint ? "text-text-on-cta opacity-75" : "text-text-muted"
            )}
          >
            {stamp}
          </span>
        )}
      </div>
      <StreamProse text={text} className="px-3 py-[9px]" />
    </div>
  );
}

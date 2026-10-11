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

export function inboundLabel(
  sender: string | null | undefined,
  fromOperator?: boolean
): string {
  if (fromOperator === true) return INBOUND_OPERATOR_LABEL;
  const name = typeof sender === "string" ? sender.trim() : "";
  return name ? `Message received from ${name}` : INBOUND_ANON_LABEL;
}

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
   *  it names the sender "you" instead. See {@link INBOUND_OPERATOR_LABEL}. */
  fromOperator?: boolean;
  /** Epoch ms. `0` means the stamp was unreadable: the tag drops rather than printing an epoch date
   *  at somebody (the sent box's rule). */
  at?: number;
}) {
  const stamp = at ? formatChannelTimestamp(new Date(at).toISOString()) : "";
  return (
    <div
      /* ⚠ THE FULLER BORDER, LIKE THE INBOUND DIRECTED BOX AND FOR ITS REASON: within an
         exchange, the arriving box is the one carrying a fact the operator did not already have —
         somebody else's words reached their agent — and this column is otherwise full of their own
         agent speaking. */
      className="min-w-0 overflow-hidden rounded-[12px] border border-border-default bg-card-surface-subtle"
      data-stream-inbound
    >
      <div className="flex items-center gap-1.5 bg-bg-inset px-2.5 py-[5px]">
        <span className="min-w-0 truncate text-micro font-medium text-text-secondary">
          {inboundLabel(sender, fromOperator)}
        </span>
        {stamp && (
          <span className="ml-auto shrink-0 text-micro text-text-muted">{stamp}</span>
        )}
      </div>
      <StreamProse text={text} className="px-3 py-[9px]" />
    </div>
  );
}

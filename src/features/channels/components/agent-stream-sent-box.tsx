"use client";

/**
 * Channels — THE OUTBOUND REVIEW CARD.
 *
 * ⚠ ITS OWN FILE by §1's "one file, one reason to change". This card moves when the OUTBOUND CONSENT product moves (§6) —
 * it has already gained a Pending face, a decision and an expiry rule, and it is
 * the ONLY review surface left now the consent inbox is deleted — where
 * `agent-stream.tsx` moves when a STREAM ROW's shape moves. It is re-exported from
 * that file, the import path its callers use.
 */

import type { IdentityFacts } from "@/shared/ui/identity-face";
import { cn } from "@/shared/lib/utils";
import { agentColorVar } from "@/shared/lib/agent-colors";
import type { RecipientTag } from "../lib/recipient-tags";
import type { PostDestination } from "./agents-model";
import { StreamCard } from "./agent-stream-card";
import { StreamProse } from "./agent-stream-prose";
import type { AgentColorKey } from "../types";
import { TAB_ACTION } from "./bits";
import { useOverflowMeasure } from "./use-overflow-measure";

/**
 * WHAT THE LABEL SAYS BEFORE A POST HAS LEFT THE MACHINE, and what it says when
 * it never will (Samuel, 2026-08-25). ⚠ Exported for the tests: "Pending" and
 * "Posted to channel" over the same box are opposite claims about whether the
 * counterparty has read something, which is the failure this card was built to
 * stop.
 */
export const POST_PENDING_LABEL = "Pending";
export const POST_NOT_SENT_LABEL = "Not sent";
export const POST_ACTION_LABEL = "Post";

/** The collapse control's two faces. ⚠ THE LOG LANE'S WORDS, DELIBERATELY
 *  (`agent-stream-log.tsx` › `LogLine`): one stream, one verb for "there is more
 *  of this than you are being shown". Exported for the tests. */
export const POST_EXPAND_LABEL = "Show more";
export const POST_COLLAPSE_LABEL = "Show less";

/**
 * **WHAT THE SETTLED LABEL SAYS — THE PLACE, BY NAME (Samuel, 2026-09-16)**: *"Posted to Dopl
 * channel. Or, posted to Yada Yada thread."* One verb for both kinds of place.
 *
 * ⚠ **THE BARE NOUN IS THE FALLBACK AND IT IS NEVER A BLANK** (INVARIANTS §11). An older main
 * reports no `channelName`, so an absent name drops the slot rather than filling it — and the kind
 * still comes through: *"Posted to thread"* is true of a thread-scoped agent whose title did not
 * arrive, and calling it the channel would be wrong. The name renders as a React TEXT CHILD on a
 * `truncate` line, the neutralisation every name render in this tree relies on.
 */
export function postedToLabel(to: PostDestination | null | undefined): string {
  const kind = to?.kind ?? "channel";
  const name = to?.name?.trim();
  return name ? `Posted to ${name} ${kind}` : `Posted to ${kind}`;
}

/**
 * HOW MUCH OF A POSTED BODY SHOWS BEFORE THE OPERATOR ASKS FOR THE REST
 * (task 10, #1058/#1059).
 *
 * ⚠ THE CLAMP IS A HEIGHT, NOT A SLICE, and that is the whole difference between
 * this lane and the log's. `agent-stream-prose.tsx` rule 4 states it: the body is
 * MARKDOWN, a slice cuts a fence or a link mid-token and renders the wreckage,
 * and `line-clamp` is a `-webkit-box` rule that does not clamp a container of
 * sibling blocks. Bounding the CONTAINER touches neither the string nor the
 * renderer — every character is still in the DOM and one press shows it.
 */
const COLLAPSED_BODY_LINES = 6;

/**
 * ⚠ READ IN `em`, AGAINST `text-caption`, SO A TOKEN CHANGE MOVES THE CLAMP WITH
 * IT. The clip box below carries `text-caption`, so `1em` is
 * `--text-caption` (11.5px today) rather than whatever the card inherits; `1.5`
 * is `leading-normal` from the body's own `textClassName`, and the `18px` is
 * `StreamProse`'s `py-[9px]` top and bottom. Change either of those two on the
 * body and change them here — that pairing is why the numbers are spelled out
 * instead of being one magic pixel count.
 */
const COLLAPSED_BODY_MAX_HEIGHT = `calc(${COLLAPSED_BODY_LINES} * 1.5em + 18px)`;

/**
 * THE BODY, BOUNDED — and the control appears ONLY on a card that is actually
 * taller than the bound (#1059, in those words).
 *
 * ⚠ THE MEASUREMENT IS `use-overflow-measure.ts`, SHARED WITH THE ARTIFACT CARD.
 * Why it measures at all rather than reading the CSS, why the observer watches the
 * inner content, and why it runs only while collapsed are all recorded there.
 *
 * ⚠ `text` IS THIS CARD'S RE-MEASURE TRIGGER: the `post` frame is pushed as the
 * agent calls the tool and this body GROWS while it streams, so a one-shot measure
 * on mount would leave the control missing on exactly the long cards it exists for.
 *
 * ⚠ `collapsible` IS THE HOOK'S `enabled`: a body still under review is rendered
 * whole and asks nothing.
 */
function SentBody({ text, collapsible }: { text: string; collapsible: boolean }) {
  const {
    open,
    setOpen,
    overflows,
    clipRef,
    contentRef,
    boxId: bodyId,
  } = useOverflowMeasure({ enabled: collapsible, remeasureOn: text });

  const prose = (
    <StreamProse
      text={text}
      className="px-3 py-[9px]"
      textClassName="text-caption leading-normal text-text-primary"
    />
  );
  if (!collapsible) return prose;

  return (
    <>
      <div
        ref={clipRef}
        id={bodyId}
        className="min-w-0 overflow-hidden text-caption"
        style={open ? undefined : { maxHeight: COLLAPSED_BODY_MAX_HEIGHT }}
      >
        <div ref={contentRef}>{prose}</div>
      </div>
      {overflows && (
        <div className="flex px-3 pb-2.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={bodyId}
            className="text-micro font-medium text-link"
          >
            {open ? POST_COLLAPSE_LABEL : POST_EXPAND_LABEL}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * WHAT THE AGENT POSTED INTO THE CHANNEL — and, before it has gone out, the place the operator
 * decides whether it does.
 *
 * ⚠ THE PENDING FACE EXISTS because the work stream's `post` frame is pushed the moment the agent
 * CALLS the tool — before the outbound consent gate has been answered, and whether or not it ever
 * will be. Without it a held draft would read "Posted to channel" over words the counterparty had
 * not seen and might never see.
 *
 * ⚠ THE CARD IS THE REVIEW SURFACE, AND IT IS THE ONLY ONE (INVARIANTS §6). The gate is unchanged —
 * the post still queues as a `channel_consent_requests` row and still needs a human — the review
 * just happens where the operator is already looking.
 *
 * ⚠ ONE BUTTON, AND IT IS "Post" (Samuel's ruling, in those words). There is no Deny here and one
 * must not be added: the only other exit is the row's own 24h expiry, and an expired draft renders
 * as {@link POST_NOT_SENT_LABEL} with nothing to press.
 *
 * ⚠ **{@link POST_NOT_SENT_LABEL} IS THE NARROWEST FACE HERE, NOT THE FALLBACK** (2026-08-25). It
 * requires a real consent row past its own TTL. Everything else this card cannot explain — a Post
 * whose delivery is still in flight, a row decided on another surface, a body-join that missed —
 * reads as {@link POST_PENDING_LABEL} with no button, because "I do not know yet" and "it failed"
 * are different facts and only one of them makes an operator re-send.
 */
export function SentToChannelBox({
  text,
  to,
  at,
  tags = [],
  pending = false,
  requestId,
  expired = false,
  onPost,
  busy = false,
  color = null,
  face = null,
}: {
  text: string;
  /**
   * **WHO THIS POST WAS ADDRESSED TO** — already-resolved faces (#3081); `[]` draws nothing.
   * ⚠ A Pending box never has any: `tags` resolve only from a stored transcript row, and a held
   * draft's addressees are not resolved by the server until it posts. Re-parsing the draft body for
   * `@handles` would be the client re-derivation `lib/recipient-tags.ts` forbids.
   */
  tags?: readonly RecipientTag[];
  /** WHERE IT WENT — see {@link postedToLabel}. `null` is "cannot say", which reads as
   *  the bare noun and never as a blank. */
  to?: PostDestination | null;
  /** Epoch ms. `0` means the stamp was unreadable — the tag drops rather than
   *  printing an epoch date at somebody. */
  at?: number;
  /** This post has NOT gone out — the outbound gate is holding it. */
  pending?: boolean;
  /** The consent row the button decides; `null` = nothing decidable matched. */
  requestId?: string | null;
  /**
   * This draft's row is past its TTL and nothing will ever post it.
   *
   * ⚠ IT IS A SEPARATE FLAG FROM `!requestId` ON PURPOSE: "no row matched" is also true of the
   * seconds between a Post and the desktop's poll delivering it. **Absence is unknown; only a dead
   * row is failure.**
   */
  expired?: boolean;
  onPost?: (requestId: string) => void;
  busy?: boolean;
  /**
   * **THIS AGENT'S COLOUR, ON THE SETTLED EDGE ONLY** (docs/specs/agent-colors.md item 5). The
   * colour is the claim *"this is in the channel, attributed to me"*, so a Pending or Not-sent
   * draft keeps the neutral edge. `null` is the neutral edge too.
   */
  color?: AgentColorKey | null;
  /** The posting agent's own face; absent draws none. */
  face?: IdentityFacts | null;
}) {
  // ⚠ THE FACES ARE ORDERED BY WHAT THEY CLAIM, strongest claim last. Only the
  // final one asserts the counterparty has it, and it is reachable ONLY once the
  // words are in the channel (`agent-stream-model.ts` clears `pending` then).
  const canPost = pending && !!requestId && !!onPost && !expired;
  const label = pending
    ? expired
      ? POST_NOT_SENT_LABEL
      : POST_PENDING_LABEL
    : postedToLabel(to);
  // ⚠ GATED ON `!pending`, the same boundary `label` is drawn on: an edge and a label that could
  // disagree about whether a post is settled is the defect this card was rebuilt to stop.
  const edge = !pending && color ? agentColorVar(color) : null;
  return (
    <StreamCard edge={edge} face={face} label={label} tags={tags} at={at}>
      {/* ⚠ ONLY THE SETTLED FACES COLLAPSE. A body still under review is the one an operator is
          deciding about, and an expired draft is the last chance to read what never went. That
          also keeps the collapse control and the Post button apart: `canPost` requires `pending`. */}
      <SentBody text={text} collapsible={!pending} />
      {/* The action sits on the last row, right-aligned. No label, no explainer, no second verb. */}
      {canPost && (
        <div className="flex justify-end px-3 pb-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onPost?.(requestId as string)}
            className={cn(TAB_ACTION, "disabled:opacity-60")}
          >
            {POST_ACTION_LABEL}
          </button>
        </div>
      )}
    </StreamCard>
  );
}

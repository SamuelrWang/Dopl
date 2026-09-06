"use client";

/**
 * Channels v2 — THE OUTBOUND REVIEW CARD, split out of `agent-stream.tsx` on
 * 2026-08-31 when that file crossed the 500-line cap (INVARIANTS §1).
 *
 * ⚠ THE SEAM IS §1's "one file, one reason to change", not the count that forced
 * the question. This card moves when the OUTBOUND CONSENT product moves (§6) —
 * it has already gained a Pending face, a decision and an expiry rule, and it is
 * the ONLY review surface left now the consent inbox is deleted — where
 * `agent-stream.tsx` moves when a STREAM ROW's shape moves. It moved VERBATIM,
 * and it is re-exported from that file so no importer changed.
 */

import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import { StreamProse } from "./agent-stream-prose";
import { TAB_ACTION } from "./bits";
import { useOverflowMeasure } from "./use-overflow-measure";

/**
 * WHAT THE BANNER SAYS BEFORE A POST HAS LEFT THE MACHINE, and what it says when
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
export const COLLAPSED_BODY_LINES = 6;

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
 * ⚠ THE MEASUREMENT IS `use-overflow-measure.ts`, SHARED WITH THE ARTIFACT CARD
 * (extracted 2026-09-06; the two were byte-identical copies). Why it measures at
 * all rather than reading the CSS, why the observer watches the inner content,
 * and why it runs only while collapsed are all recorded there. This card keeps
 * its own constants, its own labels and its own clip-box markup.
 *
 * ⚠ `text` IS THIS CARD'S RE-MEASURE TRIGGER, and it is deliberately NOT the
 * artifact card's `members.length`: the `post` frame is pushed as the agent calls
 * the tool and this body GROWS while it streams, so a one-shot measure on mount
 * would leave the control missing on exactly the long cards it exists for. It
 * also re-measures where `ResizeObserver` is absent (jsdom, old hosts).
 *
 * ⚠ `collapsible` IS THE HOOK'S `enabled`: a body still under review is rendered
 * whole and asks nothing.
 *
 * ⚠ IT WRAPS `StreamProse`, IT DOES NOT REACH INTO IT (Samuel, 2026-08-31): same
 * renderer, same props, same string as the transcript one pane over. The banner,
 * the four faces, the Post button and the expiry rule are untouched — the §6 seam
 * this card owns does not move for a render bound.
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
 * WHAT THE AGENT POSTED INTO THE CHANNEL — **the v1 session window's outbound
 * record, recovered.**
 *
 * ⚠ PROVENANCE — AND THE PATHS BELOW NO LONGER RESOLVE, WHICH IS THE POINT:
 * the `.outbound` rules (`.outbound__banner` / `__label` / `__tag` / `__body`) in
 * `renderer/session/session.css`, and their DOM factory `makeOutbound` in
 * `renderer/session/session-render.js`. Both were deleted whole in `db901c39` —
 * "desktop: wave 1 — delete the session window, whole". Read them with
 * `git show 'db901c39^:dopl-desktop-app/renderer/session/session.css'`.
 * **This is an ADAPTATION, not a byte-copy**: the geometry, the banner idea and
 * the label wording are v1's; every colour is read from the current token set per
 * docs/DESIGN-SYSTEM.md rather than from `renderer/session/tokens.css`, which was
 * that window's own private copy and no longer exists.
 *
 * ⚠ WHAT WAS KEPT, and why each part earned its way back:
 *   - **Full stream width, not a chat bubble.** v1's own comment: "a delivery
 *     RECORD, not a conversational turn, so it spans the full stream width like a
 *     tool card". That is exactly the distinction this stream needs.
 *   - **The dark CTA banner.** `--surface-cta` reads as a HEADER, which is what
 *     stops the box being mistaken for another log line.
 *   - **`border-active` + `card-surface-subtle`**, radius 12, and a `pre-wrap`
 *     body that breaks anywhere — a posted body is somebody's real words and must
 *     wrap rather than escape the column.
 *   - **The label says where it went** ("Sent to <thread>" / "Posted to channel",
 *     v1 › `outboundLabel`), and the timestamp rides in the banner's trailing tag.
 *
 * ── ⚠ v1'S PENDING FACE IS BACK, AND SO IS THE DECISION (Samuel, 2026-08-25) ──
 *
 * This docblock used to say `.outbound-pending` / `.is-not-sent` were dropped
 * "deliberately", because "this surface only ever renders posts that ALREADY
 * EXIST in the transcript". **That was never true and the box had been lying
 * since it shipped.** The work stream's `post` frame is pushed the moment the
 * agent CALLS the tool — before the outbound consent gate has been answered, and
 * whether or not it ever will be — so a held draft was painted "Posted to
 * channel" over words the counterparty had not seen and might never see.
 *
 * ⚠ THE CARD IS NOW THE REVIEW SURFACE, AND IT IS THE ONLY ONE. The separate
 * consent INBOX is deleted (INVARIANTS §6): a solo /home channel never had a way
 * to reach it, so a pending post there dead-ended forever. The gate is unchanged
 * — the post still queues as a `channel_consent_requests` row and still needs a
 * human — the review just happens where the operator is already looking.
 *
 * ⚠ ONE BUTTON, AND IT IS "Post" (Samuel's ruling, in those words). There is no
 * Deny here and one must not be added: the only other exit is the row's own 24h
 * expiry, and an expired draft renders as {@link POST_NOT_SENT_LABEL} with
 * nothing to press, which is the truth rather than a second verb.
 *
 * ⚠ **{@link POST_NOT_SENT_LABEL} IS THE NARROWEST FACE HERE, NOT THE FALLBACK
 * (corrected 2026-08-25 — Samuel saw it over a post that had DEMONSTRABLY been
 * delivered).** It requires a real consent row past its own TTL. Everything else
 * this card cannot explain — a Post whose delivery is still in flight, a row
 * decided on another surface, a body-join that missed — reads as
 * {@link POST_PENDING_LABEL} with no button, because "I do not know yet" and "it
 * failed" are different facts and only one of them makes an operator re-send.
 */
export function SentToChannelBox({
  text,
  to,
  at,
  pending = false,
  requestId,
  expired = false,
  onPost,
  busy = false,
}: {
  text: string;
  to?: string | null;
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
   * ⚠ IT IS A SEPARATE FLAG FROM `!requestId` ON PURPOSE, and that separation IS
   * the 2026-08-25 fix. The card used to read "no row matched" as failure, which
   * is also true of the seconds between a Post and the desktop's poll delivering
   * it — so an operator who had just approved a reply was told it was not sent,
   * the one wrong direction (they send it again). **Absence is unknown; only a
   * dead row is failure.**
   */
  expired?: boolean;
  onPost?: (requestId: string) => void;
  busy?: boolean;
}) {
  // ⚠ THE FACES ARE ORDERED BY WHAT THEY CLAIM, strongest claim last. Only the
  // final one asserts the counterparty has it, and it is reachable ONLY once the
  // words are in the channel (`agent-stream-model.ts` clears `pending` then).
  const canPost = pending && !!requestId && !!onPost && !expired;
  const label = pending
    ? expired
      ? POST_NOT_SENT_LABEL
      : POST_PENDING_LABEL
    : to
      ? `Sent to ${to}`
      : "Posted to channel";
  const stamp = at ? formatChannelTimestamp(new Date(at).toISOString()) : "";
  return (
    <div className="min-w-0 overflow-hidden rounded-[12px] border border-border-active bg-card-surface-subtle">
      <div className="flex items-center gap-1.5 bg-surface-cta px-2.5 py-[5px]">
        <span className="min-w-0 truncate text-micro font-medium text-text-on-cta">
          {label}
        </span>
        {stamp && (
          <span className="ml-auto shrink-0 text-micro text-text-on-cta opacity-75">
            {stamp}
          </span>
        )}
      </div>
      {/* ⚠ MARKDOWN, LIKE EVERY OTHER MESSAGE FACE (Samuel, 2026-08-31 — the
          ruling extends here). This body is the SAME STRING the transcript
          renders as markdown one pane over, so a post that read as formatted in
          the channel and as raw asterisks in the operator's own review card was
          one message wearing two faces. ⚠ THE §6 SEAM IS UNTOUCHED: the banner,
          the four faces, the Post button and the expiry rule are what this card
          owns, and none of them moved — only the body's renderer did. */}
      {/* ⚠ ONLY THE SETTLED FACES COLLAPSE — `Sent to <thread>` and `Posted to
          channel`. A body still under review is the one an operator is deciding
          about, and hiding two thirds of it behind a control that sits beside
          the Post button would be this card asking for a press on words it had
          folded away. `pending` covers {@link POST_NOT_SENT_LABEL} too: an
          expired draft is the last chance to read what never went, whole.
          ⚠ THAT ALSO KEEPS THE TWO CONTROLS APART BY CONSTRUCTION — `canPost`
          requires `pending`, so the Post button and the collapse control can
          never contend for the card's last row. */}
      <SentBody text={text} collapsible={!pending} />
      {/* ⚠ THE ACTION IS ON THE LAST ROW, RIGHT-ALIGNED — the position every card
          in this tree keeps (`bits.tsx › CARD_BUTTON`), so the eye finds the same
          control in the same corner. `TAB_ACTION`'s geometry: a 36px dark pill.
          ⚠ NO LABEL, NO EXPLAINER, NO SECOND VERB beside it (Samuel's minimal-UI
          ruling) — the banner already said Pending. */}
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
    </div>
  );
}


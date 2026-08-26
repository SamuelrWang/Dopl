"use client";

/**
 * THE AGENT'S WORK STREAM — the one lane both agent surfaces render (Samuel,
 * 2026-08-22).
 *
 * ⚠ IT IS SHARED, NOT FORKED. The slide-out panel showed a Sent-lane only and the
 * window showed a work log; they are now the same component, on the same rule as
 * `agent-composer.tsx`. Two renderers for one stream is two vocabularies for one
 * set of facts, and the panel's job — a GLANCE at what this agent is up to — is
 * the window's content at another width, not a different question.
 *
 * ⚠ FOUR LANES, THREE FACES, AND THE DISTINCTION IS THE POINT.
 *   - **`sent` wears the BOX** (`SentToChannelBox`) — it is the only thing here
 *     the counterparty can see.
 *   - **`operator` / `private` are PLAIN**, indented as a 1:1 exchange. Private
 *     traffic that looked like a channel post would let an operator believe their
 *     steer was read by the other party.
 *   - **`thinking` / `tool` / `note` are quiet log lines**, truncated and
 *     expandable, because they are the bulk and almost never the answer.
 *
 * ⚠ EVERY FRAME RENDERS, INCLUDING ONE THIS BUILD HAS NEVER HEARD OF.
 * `agent-stream-model.ts › frameLane` falls back to `note` and keeps the text —
 * the desktop's `kind` vocabulary is still growing, and a stream that silently
 * drops the frames it does not recognise is worse than one that renders them
 * plainly. The operator is reading this to find out what happened.
 */

import { useEffect, useRef, useState } from "react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import type { ChannelConsentRequest, ChannelMessage } from "../../types";
import type { AgentNarrationEntry } from "./use-agent-narration";
import { TAB_ACTION } from "./bits";
import {
  buildAgentStream,
  shortToolName,
  type StreamItem,
} from "./agent-stream-model";

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

/** What "this build cannot show the work" says, as opposed to "it has done
 *  nothing yet". ⚠ Exported for the tests: the two absences are the pair this
 *  surface most easily collapses, and collapsing them claims something about the
 *  operator's machine that it cannot know (INVARIANTS §11). */
export const NARRATION_UNSUPPORTED =
  "This build cannot show what your agent is doing.";
export const NARRATION_EMPTY = "Nothing yet. What it does will appear here.";

/** How much of a log line shows before the operator asks for more, and the
 *  ceiling on what asking gets them. ⚠ BOTH BOUNDED: a tool result can be a
 *  megabyte of JSON, and an "expand" that pastes all of it into a 380px column
 *  destroys the very stream it was meant to explain. */
const COLLAPSED_CHARS = 140;
const EXPANDED_CHARS = 2000;

export function AgentStream({
  entries,
  supported,
  sent,
  delivered,
  pending,
  onPost,
  postBusy = false,
  threadTitle,
  className,
}: {
  /** `null` = could not ask; `[]` = asked, nothing yet. ⚠ Never collapsed here. */
  entries: AgentNarrationEntry[] | null;
  /** Whether this build can show the lane at all. */
  supported: boolean;
  /** What this agent POSTED, off the channel transcript — the authoritative
   *  record of the one lane that is public. Agent-scoped (F-251). */
  sent: readonly ChannelMessage[];
  /**
   * THE WHOLE CHANNEL TRANSCRIPT, unfiltered — what a held draft's words are
   * checked against to learn whether they went out (2026-08-25). ⚠ NOT a
   * substitute for {@link sent}: this one may not be attributed to any agent,
   * which is exactly why it can answer a question the agent-scoped lane cannot.
   */
  delivered?: readonly ChannelMessage[];
  /**
   * The viewer's PENDING outbound consent rows — what turns a held draft's card
   * into a decidable one (Samuel, 2026-08-25). ⚠ Omitted renders every held
   * draft as {@link POST_NOT_SENT_LABEL}, which is the honest answer for a host
   * that cannot read them.
   */
  pending?: readonly ChannelConsentRequest[];
  /** Approve one held draft — the CAS'd `PATCH /consent/[id]` (INVARIANTS §6).
   *  ⚠ Absent renders no button at all, never a disabled one. */
  onPost?: (requestId: string) => void;
  /** A decision is in flight — the double-submit guard, not a capability. */
  postBusy?: boolean;
  threadTitle?: string | null;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  /**
   * ⚠ A `useState` SET OF PRESSED CARDS STOOD HERE AND IS DELETED (2026-08-25).
   * It existed to stop the card flashing "Not sent" in the gap between a Post
   * and the desktop's poll delivering it — and it could not do that job: local
   * state does not survive a remount, does not see a Post pressed on the OTHER
   * agent surface, and is not what made the claim wrong anyway. **The model
   * answers from server facts now** (`agent-stream-model.ts`): the words landing
   * in the channel is what retires a held card, and only a row past its own TTL
   * earns the failed face.
   */
  const items = buildAgentStream({
    entries,
    sent,
    // ⚠ THE LANDING CHECK IS CHANNEL-WIDE, THE RENDERING IS AGENT-SCOPED — see
    // the model's docblock. `sent` is filtered on `metadata.taskId`, which a
    // threadless post does not carry, so it cannot answer "did this land".
    delivered,
    pending,
    threadTitle,
  });
  // Follow the stream. Simpler than the transcript's stick-to-bottom rules on
  // purpose: this is a log, not a conversation with a reading position to
  // protect, and it grows from the bottom.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  // ⚠ THE TWO ABSENCES ARE WORDED DIFFERENTLY, and the SENT lane survives both.
  // A build with no narration op still has the transcript, so an agent that
  // posted must not read as an agent that did nothing.
  const empty = items.length === 0;

  return (
    <div
      ref={scrollerRef}
      className={cn("min-h-0 flex-1 overflow-y-auto py-3.5", className)}
    >
      {empty ? (
        <p className="py-6 text-center text-caption text-text-muted">
          {supported ? NARRATION_EMPTY : NARRATION_UNSUPPORTED}
        </p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {items.map((item) => (
            <StreamRow
              key={item.key}
              item={item}
              onPost={onPost}
              postBusy={postBusy}
            />
          ))}
        </ol>
      )}
      {!supported && !empty && (
        // The transcript carried the sent lane, but the WORK lane could not be
        // asked for — say so rather than letting a short list imply a quiet agent.
        <p className="mt-4 text-center text-micro text-text-muted">
          {NARRATION_UNSUPPORTED}
        </p>
      )}
    </div>
  );
}

function StreamRow({
  item,
  onPost,
  postBusy,
}: {
  item: StreamItem;
  onPost?: (requestId: string) => void;
  postBusy?: boolean;
}) {
  if (item.lane === "sent") {
    return (
      <li>
        <SentToChannelBox
          text={item.text}
          to={item.to}
          at={item.at}
          pending={item.pending}
          requestId={item.requestId}
          expired={item.expired}
          onPost={onPost}
          busy={postBusy}
        />
      </li>
    );
  }
  if (item.lane === "operator" || item.lane === "private") {
    return (
      <li>
        <PrivateLine text={item.text} fromOperator={item.lane === "operator"} />
      </li>
    );
  }
  return <LogLine item={item} />;
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
      <p className="wrap-anywhere whitespace-pre-wrap px-3 py-[9px] text-caption leading-normal text-text-primary">
        {text}
      </p>
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

/**
 * THE PRIVATE 1:1 EXCHANGE — plain, and plain IS the design.
 *
 * ⚠ IT MUST NOT LOOK LIKE THE BOX ABOVE. Nothing in this lane reached the
 * counterparty: the operator's steer and the agent's answer to it are out of band
 * by construction (`main/session-seed.js › frameOperatorTurn` tells the agent as
 * much). A private line wearing the sent box's banner would let an operator
 * believe the other party read something they never saw — which is the one thing
 * on this surface that is worse than showing nothing.
 *
 * The side marker is a word, not a colour: "You" / "Agent". Colour alone does not
 * survive a screenshot, a colourblind reader, or a muted theme.
 */
function PrivateLine({
  text,
  fromOperator,
}: {
  text: string;
  fromOperator: boolean;
}) {
  return (
    <div className="flex min-w-0 gap-2 border-l-2 border-border-subtle pl-2.5">
      <span
        className={cn(
          "shrink-0 text-caption font-medium",
          fromOperator ? "text-link" : "text-text-secondary"
        )}
      >
        {fromOperator ? "You" : "Agent"}
      </span>
      <span className="wrap-anywhere min-w-0 flex-1 whitespace-pre-wrap text-caption text-text-primary">
        {text}
      </span>
    </div>
  );
}

/**
 * ONE LINE OF WORK — the agent's own words, or a tool it ran.
 *
 * ⚠ TRUNCATED AND COLLAPSED BY DEFAULT (Samuel, 2026-08-22). This lane is the
 * BULK of the stream and almost never the answer: a full tool result pushes the
 * post the operator opened the panel to read off the screen. The first line is
 * enough to recognise, and the row expands when it is not.
 *
 * ⚠ THE EXPANSION IS BOUNDED TOO. A tool result can be a megabyte of JSON, and
 * "expand" pasting all of it into a 380px column destroys the stream it was meant
 * to explain. Past the ceiling the row SAYS it clipped rather than pretending
 * that was the whole thing (INVARIANTS §9 — a clipped read says so).
 *
 * The tool name is shortened HERE, at render, through the same helper the pill's
 * detail uses — main sends the raw name so one call is never named two different
 * ways on one screen.
 */
function LogLine({ item }: { item: StreamItem }) {
  const [open, setOpen] = useState(false);
  const text = item.text ?? "";
  const label =
    item.lane === "tool"
      ? item.ok === false
        ? "failed"
        : shortToolName(item.tool)
      : item.lane === "thinking"
        ? "says"
        : "";
  const tone =
    item.lane === "tool" && item.ok === false
      ? "text-danger"
      : item.lane === "note"
        ? "text-text-muted"
        : "text-text-secondary";

  const long = text.length > COLLAPSED_CHARS;
  const clipped = open && text.length > EXPANDED_CHARS;
  const shown = open
    ? text.slice(0, EXPANDED_CHARS)
    : text.slice(0, COLLAPSED_CHARS);

  return (
    <li className="flex min-w-0 gap-2 text-caption">
      {label && (
        <span className="shrink-0 font-medium text-text-primary">{label}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span
          className={cn(
            "wrap-anywhere min-w-0 whitespace-pre-wrap text-left",
            tone,
            !open && "line-clamp-2"
          )}
        >
          {shown}
          {!open && long && "…"}
        </span>
        {clipped && (
          <span className="text-micro text-text-muted">
            Clipped — open the agent&apos;s own log for the rest.
          </span>
        )}
        {long && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="shrink-0 text-micro font-medium text-link"
          >
            {open ? "Show less" : "Show more"}
          </button>
        )}
      </span>
    </li>
  );
}

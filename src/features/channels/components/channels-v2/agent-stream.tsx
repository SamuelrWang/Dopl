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
 * ⚠ FOUR LANES, FOUR FACES, AND THE DISTINCTION IS THE POINT.
 *   - **`sent` wears the BOX** (`SentToChannelBox`) — it is the only thing here
 *     the counterparty can see.
 *   - **`operator` IS THE VIEWER'S OWN TURN**: right-aligned, with their avatar
 *     and no name (Samuel, 2026-08-27). Side is the signal; the label column went.
 *   - **`private` is the AGENT's answer**: left, plain, and carrying NOTHING but
 *     the text (2026-08-27 — the quote bar and the "Agent" marker went with the
 *     "You" label; the sides are told apart by ALIGNMENT now). Private traffic
 *     that looked like a channel post would let an operator believe their steer
 *     was read by the other party.
 *   - **`thinking` / `tool` / `note` are quiet log lines** — `agent-stream-log.tsx`,
 *     where a RUN of consecutive tool activity collapses into one muted "Used N
 *     tools" row. They are the bulk and almost never the answer.
 *
 * ⚠ THE LOG LANE IS ITS OWN FILE (§1, 2026-08-27). This one owns which lane a row
 * is in and the two loud faces; `agent-stream-log.tsx` owns the bulk and how much
 * of it is showing. Both are one reason to change each.
 *
 * ⚠ EVERY FRAME RENDERS, INCLUDING ONE THIS BUILD HAS NEVER HEARD OF.
 * `agent-stream-model.ts › frameLane` falls back to `note` and keeps the text —
 * the desktop's `kind` vocabulary is still growing, and a stream that silently
 * drops the frames it does not recognise is worse than one that renders them
 * plainly. The operator is reading this to find out what happened.
 */

import { useEffect, useRef } from "react";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import type { ChannelConsentRequest, ChannelMessage } from "../../types";
import type { AgentNarrationEntry } from "./use-agent-narration";
import { TAB_ACTION } from "./bits";
import { LogLine, ToolRunGroup } from "./agent-stream-log";
import {
  buildAgentStream,
  groupStreamItems,
  type StreamGroup,
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
/**
 * THE EMPTY STATE, AS ONE BLOCK (Samuel, 2026-08-27).
 *
 * ⚠ IT WAS TWO NODES IN TWO STYLES and that is what this replaces: a muted "Send a message to
 * wake agent." over a body-size black "Chat with <agent> directly. Only your agent sees this."
 * Two sentences about one situation, in two type sizes, reading as two unrelated announcements.
 * ONE string, ONE node, ONE style.
 *
 * ⚠ AND NO NAME SUBSTITUTION. It said "Chat with Agent #k3v7d2mq directly" — an id quoted at the
 * operator before anything exists to address, which is noise where the sentence's job is to say
 * what the lane IS. "your agent" is the whole subject.
 */
export const NARRATION_EMPTY =
  "Chat with your agent privately. Send a message to wake it up.";

export function AgentStream({
  entries,
  supported,
  sent,
  delivered,
  pending,
  onPost,
  postBusy = false,
  threadTitle,
  viewer,
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
  /**
   * THE VIEWER'S OWN FACE, for the turns they typed (Samuel, 2026-08-27).
   * `view-model.ts › viewerPerson` resolves it off the transcript the host is
   * already reading — no roster, no second fetch.
   *
   * ⚠ ABSENT IS A REAL ANSWER AND RENDERS AS NO AVATAR, never as a placeholder
   * face: a viewer who has not posted in this channel has no hydrated row, and
   * inventing an identity is the one thing worse than showing none. The row is
   * still right-aligned, which is what says whose turn it is.
   */
  viewer?: AvatarPerson | null;
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
          {/* ⚠ GROUPED, NOT FILTERED (Samuel, 2026-08-27) — a run of consecutive
              tool activity is ONE muted summary row that opens onto exactly the
              rows that were here before (`agent-stream-log.tsx`). Every other
              lane passes through as a group of one, so nothing else moves. */}
          {groupStreamItems(items).map((group) => (
            <StreamRow
              key={group.key}
              group={group}
              viewer={viewer}
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
  group,
  viewer,
  onPost,
  postBusy,
}: {
  group: StreamGroup;
  viewer?: AvatarPerson | null;
  onPost?: (requestId: string) => void;
  postBusy?: boolean;
}) {
  // A tool RUN is the one group with more than one row in it, and it renders as
  // the collapsed summary. Every other lane is a group of one.
  if (group.tools !== null) return <ToolRunGroup group={group} />;
  const item = group.items[0];
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
  if (item.lane === "operator") {
    return (
      <li>
        <OperatorTurn text={item.text} viewer={viewer} />
      </li>
    );
  }
  if (item.lane === "private") {
    return (
      <li>
        <AgentTurn text={item.text} />
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
 * THE OPERATOR'S OWN TURN — right-aligned, with their face and no name (Samuel,
 * live review 2026-08-27).
 *
 * ⚠ WHAT IT REPLACES: a left row with a blue "You" in the label column, mirroring
 * the agent's. It read as a log entry ABOUT the operator rather than as something
 * they had said. Side is the whole signal now — the side every chat surface in
 * this product already uses for "mine" — so the label column goes.
 *
 * ⚠ **NO NAME AND NO EMAIL, EVER.** The avatar is the identity; a name beside it
 * is the viewer's own name quoted back at them on every line they type.
 * `Avatar` at `xs` is the compact scale (24px) — the stream is 380px wide in the
 * panel, and a `sm` face would be a third of the column.
 *
 * ⚠ IT STILL MUST NOT LOOK LIKE {@link SentToChannelBox}. Nothing in this lane
 * reached the counterparty: the operator's steer is out of band by construction
 * (`main/session-seed.js › frameOperatorTurn` tells the agent as much). A soft
 * inset block on the right is as far from the dark-bannered delivery record as
 * this column gets, which is the point of the two faces being different at all.
 */
function OperatorTurn({
  text,
  viewer,
}: {
  text: string;
  viewer?: AvatarPerson | null;
}) {
  return (
    <div className="flex min-w-0 items-start justify-end gap-2">
      <span className="wrap-anywhere max-w-[80%] whitespace-pre-wrap rounded-[10px] bg-bg-inset px-2.5 py-1.5 text-caption text-text-primary">
        {text}
      </span>
      {/* ⚠ ABSENT RATHER THAN A PLACEHOLDER when the host could not resolve the
          viewer (`view-model.ts › viewerPerson`): the row is already right-aligned,
          which is what says whose turn it is. */}
      {viewer && <Avatar person={viewer} size="xs" />}
    </div>
  );
}

/**
 * THE AGENT'S PRIVATE ANSWER — **message text, and nothing else** (Samuel, live
 * review 2026-08-27, second pass).
 *
 * ⚠ THE QUOTE BAR AND THE "Agent" MARKER ARE BOTH GONE. They came from the old
 * two-sided line, where "You" / "Agent" in a label column was how a reader told
 * the sides apart. **The right-aligned operator row now carries that whole
 * job**: one side is aligned right with a face on it, the other is plain text on
 * the left, and a rule plus a noun on top of that is chrome restating what the
 * layout already says — the same thing the `says` label was doing on the log
 * lane. This is the agent's own words; they read as words.
 *
 * ⚠ IT STILL MUST NOT LOOK LIKE {@link SentToChannelBox}, and now it is as far
 * from it as this column gets. This reply reached nobody but the operator; a
 * private line wearing the sent box's dark banner would let them believe the
 * other party read something they never saw — the one thing on this surface that
 * is worse than showing nothing. **Plain text is the face that claims least.**
 */
function AgentTurn({ text }: { text: string }) {
  return (
    <p className="wrap-anywhere min-w-0 whitespace-pre-wrap text-caption text-text-primary">
      {text}
    </p>
  );
}

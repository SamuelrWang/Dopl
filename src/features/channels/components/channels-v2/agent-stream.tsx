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
import type { ChannelMessage } from "../../types";
import type { AgentNarrationEntry } from "./use-agent-narration";
import {
  buildAgentStream,
  shortToolName,
  type StreamItem,
} from "./agent-stream-model";

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
  threadTitle,
  className,
}: {
  /** `null` = could not ask; `[]` = asked, nothing yet. ⚠ Never collapsed here. */
  entries: AgentNarrationEntry[] | null;
  /** Whether this build can show the lane at all. */
  supported: boolean;
  /** What this agent POSTED, off the channel transcript — the authoritative
   *  record of the one lane that is public. */
  sent: readonly ChannelMessage[];
  threadTitle?: string | null;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const items = buildAgentStream({ entries, sent, threadTitle });
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
            <StreamRow key={item.key} item={item} />
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

function StreamRow({ item }: { item: StreamItem }) {
  if (item.lane === "sent") {
    return (
      <li>
        <SentToChannelBox text={item.text} to={item.to} at={item.at} />
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
 * ⚠ WHAT WAS DROPPED, deliberately: `.outbound-pending` and `.is-not-sent`, the
 * whole DECISION half of that node. v1 painted the box before the operator
 * answered the outbound gate, so it needed a pending face and a "Not sent" face.
 * **This surface only ever renders posts that ALREADY EXIST in the transcript**,
 * so there is no undecided state to draw — and a pending face with nothing that
 * can reach it is exactly the dead affordance F-212 was earned on.
 */
export function SentToChannelBox({
  text,
  to,
  at,
}: {
  text: string;
  to?: string | null;
  /** Epoch ms. `0` means the stamp was unreadable — the tag drops rather than
   *  printing an epoch date at somebody. */
  at?: number;
}) {
  const label = to ? `Sent to ${to}` : "Posted to channel";
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

"use client";

/**
 * THE QUIET LANE OF THE WORK STREAM — tool runs, status notes, and the agent's
 * own words (Samuel, 2026-08-27).
 *
 * ⚠ §1 SPLIT OUT OF `agent-stream.tsx`, and the seam is a real one rather than a
 * line count: that file owns WHICH LANE a row is in and what the two loud faces
 * look like (the sent box, the private exchange); this one owns the BULK — the
 * rows nobody reads most of the time — and its whole reason to change is how
 * much of that bulk is showing. The container file was at 470 of the 500-line
 * cap when the collapsed group landed, which is the cap doing its job: it named
 * a seam that was already there.
 *
 * ── THE RULING (Samuel, live review 2026-08-27) ──
 *
 * ⚠ CONSECUTIVE TOOL ACTIVITY IS **ONE GRAY ROW**, and the detail is behind it.
 * The stream rendered every tool call as its own row of raw JSON — `ToolSearch
 * {…}`, `dopl_channel {…}`, `runs […]` — so an agent doing ordinary work buried
 * the one thing the operator opened the panel to read. The Claude-Code-desktop
 * pattern is the answer: a muted "Used 4 tools" with a chevron, collapsed by
 * default, opening onto exactly the rows that used to be there.
 *
 * ⚠ COLLAPSED IS THE DEFAULT AND THE STATE IS PER GROUP. Not persisted: this is
 * a live log, the groups are keyed on frame identity, and a remembered "open"
 * for a run that has scrolled a thousand lines up answers nobody's question.
 *
 * ⚠ NOTHING IS DROPPED, AND THE EXPANDED ROW IS THE OLD ROW UNCHANGED — same
 * tool name, same payload, same "Show more" ceiling. A summary that hid a failed
 * call would be worse than the noise it replaced, which is why the count is real
 * (`agent-stream-model.ts › groupStreamItems`) and why a FAILURE still says so
 * on the row inside.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { shortToolName, type StreamGroup, type StreamItem } from "./agent-stream-model";

/** How much of a log line shows before the operator asks for more, and the
 *  ceiling on what asking gets them. ⚠ BOTH BOUNDED: a tool result can be a
 *  megabyte of JSON, and an "expand" that pastes all of it into a 380px column
 *  destroys the very stream it was meant to explain. */
const COLLAPSED_CHARS = 140;
/**
 * THE EXPANDED CEILING — **and main is cut to the same number** (2026-08-27,
 * `main/session-narration.js › PROSE_CAP`).
 *
 * ⚠ THAT PAIRING IS THE FIX FOR A REAL BUG, not tidiness. Main used to cap the
 * agent's prose at 300 (`TEXT_CAP`, its CAPTION bound), so this clamp was being
 * raised over a string that had already been cut upstream, mid-word and with no
 * marker: pressing "Show more" revealed nothing and left the reader on
 * "…or I'll pi". With the two equal, **every frame arrives whole as far as this
 * component is willing to show**, and the clip below can only fire on a future
 * frame from a main that caps higher — where it still SAYS it clipped
 * (INVARIANTS §9). ⚠ Raise this and main's cap together, or the silent cut is
 * back.
 */
const EXPANDED_CHARS = 2000;

/** What the collapsed run says. ⚠ Exported for the test: the COUNT is the whole
 *  claim this row makes, and a summary that miscounts is a log lying about how
 *  much it is hiding. */
export function toolRunLabel(count: number): string {
  return `Used ${count} ${count === 1 ? "tool" : "tools"}`;
}

/**
 * ONE RUN OF TOOL ACTIVITY, COLLAPSED.
 *
 * ⚠ MUTED AND SMALLER THAN THE MESSAGE TEXT, on purpose. It is chrome over the
 * log, not a line of it: `text-micro` on `text-text-muted` sits a step below the
 * `text-caption` the stream's rows use, so the eye skips it exactly as it should
 * until it wants the detail.
 * ⚠ ONE BUTTON, AND THE CHEVRON IS ITS ONLY DECORATION (Samuel's minimal-UI
 * ruling) — no count badge, no "expand" verb beside the chevron.
 */
export function ToolRunGroup({ group }: { group: StreamGroup }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1 text-left text-micro text-text-muted transition-colors hover:text-text-secondary"
      >
        <Chevron size={11} aria-hidden className="shrink-0" />
        <span className="truncate">{toolRunLabel(group.tools ?? group.items.length)}</span>
      </button>
      {open && (
        // ⚠ INDENTED UNDER THE SUMMARY, not replacing it: the row that opened
        // the run stays on screen, so closing it again is where the operator
        // left off rather than a hunt back up the column.
        <ol className="flex min-w-0 flex-col gap-2.5 pl-3.5">
          {group.items.map((item) => (
            <LogLine key={item.key} item={item} />
          ))}
        </ol>
      )}
    </li>
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
 *
 * ⚠ THE AGENT'S OWN WORDS CARRY **NO LABEL** SINCE 2026-08-27 (Samuel). A
 * `thinking` row wore a bold "says" in the label column — a speech verb attached
 * to a machine, restating what the lane already is, in front of every line it
 * said. The text stands alone now, in `text-primary`: it is the one thing in
 * this lane a person actually reads, so it reads as message text and not as a
 * quoted log line. **Only the two rows that name something else keep a label** —
 * the tool's own name, and `failed`.
 */
export function LogLine({ item }: { item: StreamItem }) {
  const [open, setOpen] = useState(false);
  const text = item.text ?? "";
  const label =
    item.lane === "tool"
      ? item.ok === false
        ? "failed"
        : shortToolName(item.tool)
      : "";
  const tone =
    item.lane === "tool" && item.ok === false
      ? "text-danger"
      : item.lane === "note"
        ? "text-text-muted"
        : item.lane === "thinking"
          ? "text-text-primary"
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

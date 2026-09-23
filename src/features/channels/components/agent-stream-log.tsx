"use client";

/**
 * The quiet lane of the work stream: log lines, with each run of consecutive tool activity collapsed
 * into one "Used N tools" row that expands onto the unchanged rows (count from `groupStreamItems`).
 */

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { shortToolName, type StreamGroup, type StreamItem } from "./agent-stream-model";

/** Collapsed preview length. Both bounds exist because a tool result can be megabytes of JSON. */
const COLLAPSED_CHARS = 140;
/** Kept equal to `main/narration-text.js › PROSE_CAP` — raise both together. */
const EXPANDED_CHARS = 8000;

/** The collapsed run's label; exported for the test. */
export function toolRunLabel(count: number): string {
  return `Used ${count} ${count === 1 ? "tool" : "tools"}`;
}

/** One run of tool activity; collapsed by default, state per group and not persisted. */
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
        <ol className="flex min-w-0 flex-col gap-2.5 pl-3.5">
          {group.items.map((item) => (
            <LogLine key={item.key} item={item} />
          ))}
        </ol>
      )}
    </li>
  );
}

/** One log line: clamped to two lines, expandable up to {@link EXPANDED_CHARS}, and says when clipped
 *  (INVARIANTS §9). Only tool rows carry a label (the tool's short name, or `failed`). */
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
  // A main-cut line arrives at exactly EXPANDED_CHARS, so the length check alone would call it whole.
  const mainCut = item.truncated === true;
  const clipped = open && (text.length > EXPANDED_CHARS || mainCut);
  const shown = open
    ? text.slice(0, EXPANDED_CHARS)
    : text.slice(0, COLLAPSED_CHARS);

  return (
    <li className="flex min-w-0 flex-col gap-0.5 text-caption">
      {label && (
        <span className="min-w-0 truncate font-medium text-text-primary">{label}</span>
      )}
      <span className="flex w-full min-w-0 flex-col items-start gap-0.5">
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
            {/* A main cut kept no tail anywhere; a renderer clip has a fuller copy in the agent's log. */}
            {mainCut
              ? "Clipped — the message was longer than the panel keeps."
              : "Clipped — open the agent's own log for the rest."}
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

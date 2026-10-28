"use client";

import { Play, Repeat } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import { StatusPill, type StatusTone } from "@/shared/ui/status-pill";
import { TEXT_LINK_BUTTON } from "@/shared/ui/text-link";
import { ROW_CARD_ROW } from "@/features/channels/components/bits";
import { TaskTickFace, taskTickClass } from "@/features/channels/components/task-bits";
import type { TaskStatus } from "@/features/channels/types";
import { channelName } from "../data/channels";
import type { AgendaEntry, AgendaState } from "../data/agenda";
import { MISSED_LINE } from "../model/schedule";
import { AssignmentFaces } from "./assignee";

/** Time column + spine column, shared by every row and the now rule so they line up. */
export const SPINE_GRID = "grid grid-cols-[40px_16px_minmax(0,1fr)_auto] items-center gap-x-2.5";

/** The spine itself: a hairline through the ring column, behind the rings. */
const SPINE_LINE =
  "pointer-events-none absolute bottom-0 top-0 left-[calc(40px+0.625rem+7.5px)] w-px bg-border-default";

const STATE: Record<AgendaState, { label: string; tone: StatusTone; dot?: boolean; tick: TaskStatus }> = {
  upcoming: { label: "Scheduled", tone: "neutral", tick: "open" },
  open: { label: "Open", tone: "neutral", tick: "open" },
  running: { label: "Running", tone: "live", dot: true, tick: "in_progress" },
  needs_you: { label: "Needs you", tone: "attention", tick: "in_progress" },
  done: { label: "Done", tone: "done", tick: "resolved" },
  missed: { label: "Missed", tone: "neutral", tick: "open" },
};

/** One entry on the spine: its hour, its ring on the line, title and meta, then state and faces. */
export function AgendaRow({
  entry,
  scheduleLine,
  assignmentFor,
  onOpen,
  onRunNow,
}: {
  entry: AgendaEntry;
  /** A saved task's schedule ("Every weekday at 8:30"); absent for a one-off. */
  scheduleLine: string | null;
  /** Faces for the entry: the saved task's own assignment, or the one-off's. */
  assignmentFor: (entry: AgendaEntry) => Parameters<typeof AssignmentFaces>[0]["task"];
  onOpen: () => void;
  /** Missed runs only: start it now. */
  onRunNow?: () => void;
}) {
  const state = STATE[entry.state];
  const tick = { status: state.tick, progress: entry.progress };
  const missed = entry.state === "missed";
  const label = entry.progress && entry.state === "running" ? `${state.label} ${entry.progress.done}/${entry.progress.total}` : state.label;

  return (
    <li data-state={entry.state} className={cn(ROW_CARD_ROW, SPINE_GRID, "relative min-h-13 py-2")}>
      <span className={SPINE_LINE} aria-hidden="true" />
      <span className="flex flex-col text-right">
        {entry.weekday && <span className="text-label text-text-muted">{entry.weekday}</span>}
        <span
          className={cn(
            "text-caption tabular-nums",
            missed ? "text-text-muted line-through" : "font-medium text-text-primary"
          )}
        >
          {entry.time ?? ""}
        </span>
      </span>
      <span className={cn("relative rounded-full bg-bg-overlay", taskTickClass(tick))} data-status={tick.status}>
        <TaskTickFace task={tick} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.75">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${entry.title}`}
          className={cn(
            "p-0 text-left text-body font-medium leading-[1.35]",
            TEXT_LINK_BUTTON,
            entry.state === "done" || missed ? "text-text-muted" : "text-text-primary"
          )}
        >
          {entry.title}
        </button>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.25 gap-y-0.5 text-label text-text-muted">
          <span>{`#${channelName(entry.channelId)}`}</span>
          <span className="text-text-disabled">·</span>
          {scheduleLine ? (
            <span className="inline-flex items-center gap-1">
              <Repeat size={11} strokeWidth={2} aria-hidden="true" />
              {scheduleLine}
            </span>
          ) : (
            <span>One-off task</span>
          )}
          {(missed || entry.note) && (
            <>
              <span className="text-text-disabled">·</span>
              <span>{missed ? MISSED_LINE : entry.note}</span>
            </>
          )}
        </span>
      </span>
      <span className="flex items-center gap-2.5">
        <AssignmentFaces task={assignmentFor(entry)} size="s" />
        <StatusPill tone={state.tone} dot={state.dot}>
          {label}
        </StatusPill>
        {missed && onRunNow && (
          <OpenScaleButton onClick={onRunNow} className="flex-none gap-1.5">
            <Play size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
            Run now
          </OpenScaleButton>
        )}
      </span>
    </li>
  );
}

/** The now rule across Today: the hour, an ink dot on the spine, a hairline in ink. */
export function NowRule({ label }: { label: string }) {
  return (
    <li aria-label={`Now, ${label}`} className={cn(SPINE_GRID, "relative py-1")}>
      <span className="text-right text-label font-semibold tabular-nums text-text-primary">{label}</span>
      <span className="flex justify-center" aria-hidden="true">
        <span className="size-2 rounded-full bg-text-primary" />
      </span>
      <span className="col-span-2 h-px bg-text-primary" aria-hidden="true" />
    </li>
  );
}

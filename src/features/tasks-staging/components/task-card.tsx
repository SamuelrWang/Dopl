"use client";

import { CalendarClock, Hash, Play, Repeat } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { StatusPill } from "@/shared/ui/status-pill";
import { FactChip } from "@/features/agent-identities/components/identity-section";
import { TaskTickFace, taskTickClass } from "@/features/channels/components/task-bits";
import type { TaskStatus } from "@/features/channels/types";
import { channelName } from "../data/channels";
import type { RunResult, SavedTask } from "../data/saved-tasks";
import { RUN_RESULT, latestRun, scheduleLabel } from "../model/schedule";
import styles from "../tasks.module.css";
import { AssignmentFaces } from "./assignee";

const TICK: Record<RunResult, TaskStatus> = {
  running: "in_progress",
  needs_you: "in_progress",
  done: "resolved",
  failed: "open",
  missed: "open",
};

/** The channel Tasks ring for a task: its latest run's progress, one segment per step. */
export function TaskRing({ task }: { task: SavedTask }) {
  const run = latestRun(task);
  const total = task.steps.length;
  const status: TaskStatus = run ? TICK[run.result] : "open";
  const tick = {
    status,
    progress: total > 0 ? { done: run?.result === "done" ? total : (run?.done ?? 0), total } : null,
  };
  return (
    <span className={taskTickClass(tick)} data-status={tick.status} aria-hidden="true">
      <TaskTickFace task={tick} />
    </span>
  );
}

/** "Every weekday at 8:30", "Due Today 14:00", "Anytime". */
function whenLine(task: SavedTask): string {
  if (task.kind === "one-off") return task.due ? `Due ${task.due}` : "Anytime";
  return scheduleLabel(task.schedule);
}

/** The footer's quiet fact: the next run, the last one, or nothing yet. */
function nextLine(task: SavedTask): string {
  if (task.nextRun) return `Next ${task.nextRun}`;
  const run = latestRun(task);
  return run ? `Last ${run.when}` : "Not started";
}

/**
 * One task as a compact card, the identity card's recipe (`white-card card-lift`, the 14px name
 * face, fact chips, a hairline footer): ring and name with the live state, when and where, then
 * who and Launch.
 */
export function TaskCard({
  task,
  starting,
  onOpen,
  onLaunch,
}: {
  task: SavedTask;
  starting: boolean;
  onOpen: () => void;
  onLaunch: () => void;
}) {
  const run = latestRun(task);
  const live = run && (run.result === "running" || run.result === "needs_you" || run.result === "missed");

  return (
    <div data-kind={task.kind} className={cn("white-card card-lift", styles.card)}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${task.title}`}
        className="flex min-w-0 cursor-pointer flex-col items-start gap-2.5 text-left"
      >
        <span className="flex w-full min-w-0 items-center gap-2.5">
          <TaskRing task={task} />
          <span className={cn("min-w-0 flex-1 truncate", IDENTITY_NAME_TEXT)}>{task.title}</span>
          {live && run && (
            <StatusPill tone={RUN_RESULT[run.result].tone} dot={run.result === "running"}>
              {run.result === "running" ? `${run.done}/${run.total}` : RUN_RESULT[run.result].label}
            </StatusPill>
          )}
        </span>
        <span className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
          <FactChip
            mark={
              task.schedule.on ? (
                <Repeat size={12} strokeWidth={2} aria-hidden="true" />
              ) : (
                <CalendarClock size={12} strokeWidth={2} aria-hidden="true" />
              )
            }
          >
            {whenLine(task)}
          </FactChip>
          <FactChip mark={<Hash size={12} strokeWidth={2} aria-hidden="true" />}>
            {channelName(task.channelId)}
          </FactChip>
        </span>
      </button>
      <div className={styles.cardFoot}>
        <AssignmentFaces task={task} size="s" />
        <span className="min-w-0 flex-1 truncate text-right text-label text-text-muted">{nextLine(task)}</span>
        <OpenScaleButton
          onClick={onLaunch}
          disabled={starting || run?.result === "running"}
          className="flex-none gap-1.5 disabled:opacity-60"
        >
          <Play size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
          {starting ? "Starting…" : run?.result === "missed" ? "Run now" : "Launch"}
        </OpenScaleButton>
      </div>
    </div>
  );
}

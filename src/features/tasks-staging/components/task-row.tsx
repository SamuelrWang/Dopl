"use client";

import { Play, Repeat } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { TEXT_LINK_BUTTON } from "@/shared/ui/text-link";
import { ROW_CARD_ROW } from "@/features/channels/components/bits";
import { TaskTickFace, taskTickClass } from "@/features/channels/components/task-bits";
import type { TaskStatus } from "@/features/channels/types";
import { channelName } from "../data/channels";
import type { RunResult, SavedTask } from "../data/saved-tasks";
import { RUN_RESULT, latestRun, scheduleLabel } from "../model/schedule";
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

/** What the right side says: the next run, or the live state of the latest one. */
function nextLine(task: SavedTask): string {
  if (task.nextRun) return `Next ${task.nextRun}`;
  const run = latestRun(task);
  if (run) return `Last ${run.when}`;
  return "Not started";
}

/** The grid every row and the list's column heads share. */
export const TASK_ROW_GRID =
  "grid grid-cols-[16px_minmax(0,1fr)_96px_140px_96px] items-center gap-x-3";

/** One task as a dense row: ring, title, schedule, assignees, next run, Launch. */
export function TaskRow({
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
  const state = live ? RUN_RESULT[run.result] : null;

  return (
    <li data-kind={task.kind} className={cn(ROW_CARD_ROW, TASK_ROW_GRID, "min-h-12 py-1.5")}>
      <TaskRing task={task} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${task.title}`}
          className={cn("min-w-0 truncate p-0 text-left text-small font-medium text-text-primary", TEXT_LINK_BUTTON)}
        >
          {task.title}
        </button>
        <span className="flex min-w-0 items-center gap-1 text-label text-text-muted">
          {task.schedule.on && <Repeat size={11} strokeWidth={2} aria-hidden="true" className="flex-none" />}
          <span className="truncate">{`${whenLine(task)} · #${channelName(task.channelId)}`}</span>
        </span>
      </span>
      <span className="flex min-w-0 justify-start">
        <AssignmentFaces task={task} size="s" />
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        {state && run ? (
          <StatusPill tone={state.tone} dot={run.result === "running"}>
            {run.result === "running" ? `${state.label} ${run.done}/${run.total}` : state.label}
          </StatusPill>
        ) : (
          <span className="truncate text-caption tabular-nums text-text-secondary">{nextLine(task)}</span>
        )}
      </span>
      <span className="flex justify-end">
        <OpenScaleButton
          onClick={onLaunch}
          disabled={starting || run?.result === "running"}
          className="gap-1.5 disabled:opacity-60"
        >
          <Play size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
          {starting ? "Starting…" : run?.result === "missed" ? "Run now" : "Launch"}
        </OpenScaleButton>
      </span>
    </li>
  );
}

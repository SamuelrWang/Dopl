"use client";

import { CalendarClock, Hash, Play, Repeat } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
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

/**
 * The channel Tasks ring for a task: its latest run's progress, one segment per step. Omitted when
 * it would be an empty ring (no run, or a missed or failed run with no step done): it says nothing.
 */
export function TaskRing({ task }: { task: SavedTask }) {
  const run = latestRun(task);
  if (!run || (run.done === 0 && (run.result === "missed" || run.result === "failed"))) return null;
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

/** "Today 11:05" → "today 11:05" mid-sentence; dates and weekdays keep their capital. */
const RELATIVE = /^(Today|Tomorrow|Yesterday|Just now)\b/;
const midSentence = (when: string) => when.replace(RELATIVE, (word) => word.toLowerCase());

/** The footer's quiet fact: "Next run tomorrow 8:30", "Last run today 11:05", or nothing yet. */
function nextLine(task: SavedTask): string {
  if (task.nextRun) return `Next run ${midSentence(task.nextRun)}`;
  const run = latestRun(task);
  return run ? `Last run ${midSentence(run.when)}` : "Not started";
}

/**
 * One task as a compact card, the identity card's recipe (`white-card card-lift`, fact chips, a
 * hairline footer) with a 13px name, one step under the 14px identity face so the week bar above
 * stays the page's anchor: ring and name with the live state, when and where, then who and Launch.
 * The name wraps to two lines before any pill can cut it; "Needs you" is never a pill here, since
 * the group it sits in already says it.
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
  const live = run && (run.result === "running" || run.result === "missed");

  return (
    <div data-kind={task.kind} className={cn("white-card card-lift", styles.card)}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${task.title}`}
        className="flex min-w-0 cursor-pointer flex-col items-start gap-2.5 text-left"
      >
        <span className="flex w-full min-w-0 items-start gap-2.5">
          {/* One title line tall, so the ring centres on the first line of a wrapped name. */}
          <span className="flex h-[1.55em] flex-none items-center text-lead empty:hidden">
            <TaskRing task={task} />
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 text-lead font-medium text-text-primary">{task.title}</span>
          {live && run && (
            <StatusPill className="flex-none" tone={RUN_RESULT[run.result].tone} dot={run.result === "running"}>
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

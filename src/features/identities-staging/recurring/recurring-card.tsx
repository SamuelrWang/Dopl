"use client";

import { ListChecks, Play, Repeat } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { AvatarScale } from "@/shared/ui/avatar-size";
import { IdentityStack } from "@/shared/ui/avatar-stack";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import { useRuntimeLogo } from "@/shared/ui/runtime-logo";
import { StatusPill } from "@/shared/ui/status-pill";
import { FactChip } from "@/features/agent-identities/components/identity-section";
import { TaskTickFace, taskTickClass } from "@/features/channels/components/task-bits";
import { photoOf } from "../data-agents";
import type { RecurringTask } from "../data/recurring-tasks";
import { identityOf } from "../teams/team-model";
import { identitiesOf, latestRun, scheduleLabel } from "./recurring-model";

/**
 * The task's tick: the channel Tasks ring, one segment per subtask, filled to the latest run.
 * A finished run shows the full ring and the check; no run yet shows the empty segments.
 */
export function RecurringRing({ task }: { task: RecurringTask }) {
  const run = latestRun(task);
  const total = task.subtasks.length;
  const tick = {
    status: run?.result === "running" ? ("in_progress" as const) : ("open" as const),
    progress: total > 0 ? { done: run?.result === "done" ? total : (run?.done ?? 0), total } : null,
  };
  return (
    <span className={taskTickClass(tick)} data-status={tick.status}>
      <TaskTickFace task={tick} />
    </span>
  );
}

/** The identities a task launches, as one stack: owner photo, runtime badge, neutral ring. */
export function RecurringStack({ task, size }: { task: RecurringTask; size: AvatarScale }) {
  const logoFor = useRuntimeLogo();
  const ids = identitiesOf(task);
  return (
    <IdentityStack
      size={size}
      max={4}
      label={ids.map((id) => identityOf(id)?.name ?? "Deleted identity").join(", ")}
      faces={ids.map((id) => {
        const identity = identityOf(id);
        return {
          key: id,
          photo: photoOf(identity?.createdBy ?? null),
          runtimeLogo: logoFor(identity?.runtime),
          ring: "neutral" as const,
        };
      })}
    />
  );
}

export type RecurringLaunchState = "idle" | "starting";

/** One recurring task as a card: ring and title, who works it, its schedule, and Launch. */
export function RecurringCard({
  task,
  marker,
  launch,
  onOpen,
  onLaunch,
}: {
  task: RecurringTask;
  /** `by <member>` for a task the viewer did not write. */
  marker: string | null;
  /** `null` = no channel selected, so nothing to launch into. */
  launch: RecurringLaunchState | null;
  onOpen: () => void;
  onLaunch: () => void;
}) {
  const run = latestRun(task);
  const running = run?.result === "running";
  const n = task.subtasks.length;

  return (
    <div className="white-card card-lift flex min-h-[104px] flex-col gap-2.5 p-3 text-left">
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 cursor-pointer flex-col items-start gap-2.5 text-left"
      >
        <span className="flex w-full min-w-0 items-center gap-2.5">
          <RecurringRing task={task} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn("min-w-0 truncate", IDENTITY_NAME_TEXT)}>{task.title}</span>
            {marker && <span className="min-w-0 truncate text-label text-text-muted">{marker}</span>}
          </span>
          <RecurringStack task={task} size="s" />
        </span>
        <span className="line-clamp-2 text-small leading-relaxed text-text-secondary">
          {task.description}
        </span>
        <span className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
          <FactChip mark={<Repeat size={12} strokeWidth={2} aria-hidden="true" />}>
            {scheduleLabel(task.schedule)}
          </FactChip>
          <FactChip mark={<ListChecks size={12} strokeWidth={2} aria-hidden="true" />}>
            {`${n} ${n === 1 ? "subtask" : "subtasks"}`}
          </FactChip>
        </span>
      </button>
      <div className="mt-auto flex w-full items-center justify-between gap-2 border-t border-border-default pt-2.5">
        {running ? (
          <StatusPill dot tone="live" bare>
            {`Running ${run.done}/${run.total}`}
          </StatusPill>
        ) : (
          <span className="min-w-0 truncate text-label text-text-muted">
            {task.nextRun ? `Next ${task.nextRun}` : run ? `Last ${run.when}` : "Never run"}
          </span>
        )}
        {launch && (
          <OpenScaleButton
            onClick={onLaunch}
            disabled={launch === "starting" || running}
            className="flex-none gap-1.5 disabled:opacity-60"
          >
            <Play size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
            {launch === "starting" ? "Starting…" : "Launch"}
          </OpenScaleButton>
        )}
      </div>
    </div>
  );
}

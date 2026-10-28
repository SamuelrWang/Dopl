"use client";

import { Check, Hash, ListChecks, MessageSquare } from "lucide-react";
import { IdentityStack } from "@/shared/ui/avatar-stack";
import { cn } from "@/shared/lib/utils";
import { actorKey } from "../lib/task-model";
import { taskStackFace, type TaskFaceOf } from "./task-faces";
import type { ChannelTask, TaskActor, TaskLink, TaskStatus } from "../types";

/** The round status tick (the landing Tasks window's `.lp-ont-tick`): ring, half ring, filled. */
export const TASK_TICK =
  "grid size-4 flex-none place-items-center rounded-full border-(length:--stroke-mark) border-[var(--raised-light-line)] " +
  "text-text-on-invert transition-colors data-[status=in_progress]:border-border-default " +
  "data-[status=in_progress]:border-t-text-primary data-[status=resolved]:border-text-primary " +
  "data-[status=resolved]:bg-text-primary";

/** The tick's hover, only where it is the Resolve / Reopen control. */
export const TASK_TICK_CONTROL = "hover:border-text-primary";

export function TaskTickMark({ status }: { status: TaskStatus }) {
  return status === "resolved" ? <Check size={10} strokeWidth={3} aria-hidden="true" /> : null;
}

/**
 * THE PROGRESS RING (Samuel, 2026-10-28): a task with steps draws its tick as a thick ring cut
 * into one segment per step, each done step filling one. All steps done → a full ring with the
 * check inside. A RESOLVED task, or one with no steps, keeps the plain tick above.
 * It reads `task.progress` only (`task-model.ts › subtaskFacts`); no fetch, no state of its own.
 */
const TASK_RING =
  "group/tick grid size-4 flex-none place-items-center rounded-full text-text-primary";

/** Whether this task's tick is the ring rather than the plain tick. */
function hasRing(task: Pick<ChannelTask, "status" | "progress">): boolean {
  return task.status !== "resolved" && !!task.progress && task.progress.total > 0;
}

/** The tick's class: the plain tick, or the ring's bare box (same 16px, so rows never shift). */
export function taskTickClass(task: Pick<ChannelTask, "status" | "progress">): string {
  return hasRing(task) ? TASK_RING : TASK_TICK;
}

/** What sits inside the tick: today's mark, or the segmented ring. */
export function TaskTickFace({ task }: { task: Pick<ChannelTask, "status" | "progress"> }) {
  if (!hasRing(task) || !task.progress) return <TaskTickMark status={task.status} />;
  return <TaskProgressRing done={task.progress.done} total={task.progress.total} />;
}

const RING_BOX = 16;
const RING_STROKE = 2.5;
const RING_R = (RING_BOX - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

function TaskProgressRing({ done, total }: { done: number; total: number }) {
  const complete = done >= total;
  // One gap per segment, shrunk with the count so many steps still read as segments.
  const gap = total > 1 ? Math.min(1.75, (RING_C / total) * 0.3) : 0;
  const seg = RING_C / total - gap;
  return (
    <span className="relative grid size-4 place-items-center" aria-hidden="true">
      <svg
        width={RING_BOX}
        height={RING_BOX}
        viewBox={`0 0 ${RING_BOX} ${RING_BOX}`}
        className="absolute inset-0 -rotate-90"
      >
        {Array.from({ length: total }, (_, i) => (
          <circle
            key={i}
            cx={RING_BOX / 2}
            cy={RING_BOX / 2}
            r={RING_R}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeDasharray={`${seg} ${RING_C - seg}`}
            // Each segment starts where the last one's gap ends (offset is negative = forward).
            strokeDashoffset={-(i * (seg + gap)) - gap / 2}
            className={
              i < done
                ? "stroke-text-primary"
                : "stroke-[var(--raised-light-line)] transition-colors group-hover/tick:stroke-text-muted"
            }
          />
        ))}
      </svg>
      {complete && <Check size={8} strokeWidth={3.5} className="relative" />}
    </span>
  );
}

/** "Resolve" on an active task, "Reopen" on a resolved one; both are `set_status`. */
export function nextStatus(task: ChannelTask): { status: TaskStatus; verb: string } {
  return task.status === "resolved"
    ? { status: "open", verb: "Reopen" }
    : { status: "resolved", verb: "Resolve" };
}

/** The assignees as one stack; an actor in `active` (on an in-progress subtask) gets the green dot. */
export function TaskAssignees({
  actors,
  faceOf,
  active,
}: {
  actors: readonly TaskActor[];
  faceOf: TaskFaceOf;
  active?: ReadonlySet<string>;
}) {
  const faces = actors.map((a) => ({
    ...taskStackFace(a, faceOf),
    online: active?.has(actorKey(a)) ?? false,
  }));
  const names = faces.map((f) => (f.online ? `${f.name} (active)` : f.name)).join(", ");
  return <IdentityStack faces={faces} size={22} max={3} label={`Assigned to ${names}`} />;
}

/** The thread or message a task came from; pressing it opens that. */
export function TaskLinkChip({
  link,
  onOpen,
  className,
}: {
  link: TaskLink;
  onOpen: (link: TaskLink) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(link)}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-0.75 rounded-full bg-bg-inset h-4.5 px-1.5 text-label text-text-secondary transition-colors hover:bg-bg-inset-hover",
        className
      )}
    >
      {link.kind === "thread" ? (
        <Hash size={11} aria-hidden="true" className="flex-none" />
      ) : (
        <MessageSquare size={11} aria-hidden="true" className="flex-none" />
      )}
      <span className="truncate">{link.kind === "thread" ? link.title : "Message"}</span>
    </button>
  );
}

/** "2/4" subtasks done. */
export function TaskProgress({ task }: { task: Pick<ChannelTask, "progress"> }) {
  if (!task.progress) return null;
  const { done, total } = task.progress;
  return (
    <span
      role="img"
      aria-label={`${done} of ${total} subtasks done`}
      className="inline-flex items-center gap-0.75 text-micro tabular-nums text-text-muted"
    >
      <ListChecks size={11} aria-hidden="true" />
      {done}/{total}
    </span>
  );
}

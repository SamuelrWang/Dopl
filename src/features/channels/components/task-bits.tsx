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

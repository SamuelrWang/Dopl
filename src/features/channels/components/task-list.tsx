"use client";

import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { IdentityFace } from "@/shared/ui/identity-face";
import { TEXT_LINK_BUTTON } from "@/shared/ui/text-link";
import { StatusPill } from "@/shared/ui/status-pill";
import { byTaskOrder, isActiveTask } from "../lib/task-model";
import {
  TASK_TICK_CONTROL,
  TaskAssignees,
  TaskLinkChip,
  TaskProgress,
  TaskTickFace,
  nextStatus,
  taskTickClass,
} from "./task-bits";
import { ROW_CARD, ROW_CARD_ROW } from "./bits";
import { STATUS_TONE, TASK_STATUS_LABEL, type TaskFaceOf } from "./task-faces";
import type { ChannelTask, TaskLink, TaskStatus } from "../types";

export interface TaskListProps {
  tasks: readonly ChannelTask[];
  /** The read came back at its ceiling; said under the list (INVARIANTS §9). */
  truncated?: boolean;
  /** The Resolved group starts expanded. */
  defaultResolvedOpen?: boolean;
  faceOf: TaskFaceOf;
  /** Absent (a guest) draws the tick as a mark, not a control. */
  onSetStatus?: (task: ChannelTask, status: TaskStatus) => void;
  onOpen: (taskId: string) => void;
  onOpenLink: (link: TaskLink) => void;
}

function TaskRow({
  task,
  faceOf,
  onSetStatus,
  onOpen,
  onOpenLink,
}: { task: ChannelTask } & Omit<TaskListProps, "tasks" | "truncated">) {
  const done = task.status === "resolved";
  const next = nextStatus(task);
  const by = done && task.resolvedBy ? task.resolvedBy : task.createdBy;
  const face = faceOf(by);
  return (
    <li
      data-status={task.status}
      className={cn(
        ROW_CARD_ROW,
        "grid min-h-13 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 py-2"
      )}
    >
      {onSetStatus ? (
        <button
          type="button"
          data-status={task.status}
          aria-label={`${next.verb} ${task.title}`}
          title={next.verb}
          onClick={() => onSetStatus(task, next.status)}
          className={cn(taskTickClass(task), TASK_TICK_CONTROL)}
        >
          <TaskTickFace task={task} />
        </button>
      ) : (
        <span data-status={task.status} aria-hidden="true" className={taskTickClass(task)}>
          <TaskTickFace task={task} />
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-0.75">
        <button
          type="button"
          aria-label={`Open ${task.title}`}
          onClick={() => onOpen(task.id)}
          className={cn(
            "p-0 text-left text-body font-medium leading-[1.35]",
            TEXT_LINK_BUTTON,
            done ? "text-text-muted" : "text-text-primary"
          )}
        >
          {task.title}
        </button>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.25 gap-y-0.5 text-label text-text-muted">
          <IdentityFace size={14} {...face} />
          <span>
            {face.name} {done ? "resolved" : "opened"}{" "}
            {formatRelativeTime(done ? task.resolvedAt : task.createdAt)}
          </span>
          {task.link && <TaskLinkChip link={task.link} onOpen={onOpenLink} />}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1.25">
        <TaskAssignees actors={task.assignees} faceOf={faceOf} />
        <span className="inline-flex items-center gap-1.5">
          <TaskProgress task={task} />
          <StatusPill tone={STATUS_TONE[task.status]}>
            {TASK_STATUS_LABEL[task.status]}
          </StatusPill>
        </span>
      </span>
    </li>
  );
}

/** Active tasks in one card, resolved ones collapsed under a "Resolved N" toggle. */
export function TaskList({
  tasks,
  truncated = false,
  defaultResolvedOpen = false,
  ...row
}: TaskListProps) {
  const [resolvedOpen, setResolvedOpen] = useState(defaultResolvedOpen);
  if (tasks.length === 0) {
    return <EmptyState variant="well" icon={Check} title="No tasks yet" />;
  }
  const active = tasks.filter(isActiveTask).sort(byTaskOrder);
  const resolved = tasks.filter((t) => !isActiveTask(t)).sort(byTaskOrder);
  const rows = (list: readonly ChannelTask[]) =>
    list.map((t) => <TaskRow key={t.id} task={t} {...row} />);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {active.length > 0 ? (
        <ul aria-label="Active tasks" className={ROW_CARD}>
          {rows(active)}
        </ul>
      ) : (
        <EmptyState variant="well" icon={Check} title="All tasks resolved" />
      )}
      {resolved.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={resolvedOpen}
            onClick={() => setResolvedOpen((v) => !v)}
            className="inline-flex items-center gap-1 self-start px-0.5 py-1 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            <ChevronRight
              size={12}
              aria-hidden="true"
              className={cn("transition-transform", resolvedOpen && "rotate-90")}
            />
            Resolved
            <span className="text-text-muted">{resolved.length}</span>
          </button>
          {resolvedOpen && (
            <ul aria-label="Resolved tasks" className={ROW_CARD}>
              {rows(resolved)}
            </ul>
          )}
        </>
      )}
      {truncated && (
        <p className="px-0.5 text-caption text-text-muted">Showing the most recent tasks</p>
      )}
    </div>
  );
}

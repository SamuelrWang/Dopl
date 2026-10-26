"use client";

import { TaskDetail, type TaskDetailProps } from "./task-detail";
import { TaskList, type TaskListProps } from "./task-list";
import type { ChannelTaskDetail } from "../types";

export type TasksPanelProps = Omit<TaskListProps, "onOpen"> &
  Pick<TaskDetailProps, "onToggleSubtask" | "onAddNote"> & {
    /** The first list read is in flight: nothing is measured yet (INVARIANTS §11). */
    loading?: boolean;
    /** The task whose detail is showing; `null` (or a task no longer listed) is the list. */
    openTaskId: string | null;
    onOpenTask: (taskId: string | null) => void;
    /** The open task's detail read, `null` while it is in flight. */
    detail: ChannelTaskDetail | null;
  };

/** The Tasks tab's body: the list, or one task's detail drilled into in place. */
export function TasksPanel({
  loading = false,
  openTaskId,
  onOpenTask,
  detail,
  onToggleSubtask,
  onAddNote,
  ...list
}: TasksPanelProps) {
  const open = list.tasks.find((t) => t.id === openTaskId) ?? null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
      {open ? (
        <TaskDetail
          task={open}
          detail={detail?.id === open.id ? detail : null}
          faceOf={list.faceOf}
          onBack={() => onOpenTask(null)}
          onOpenLink={list.onOpenLink}
          onSetStatus={list.onSetStatus}
          onToggleSubtask={onToggleSubtask}
          onAddNote={onAddNote}
        />
      ) : loading && list.tasks.length === 0 ? (
        <p role="status" aria-busy="true" className="sr-only">
          Loading tasks
        </p>
      ) : (
        <TaskList {...list} onOpen={onOpenTask} />
      )}
    </div>
  );
}

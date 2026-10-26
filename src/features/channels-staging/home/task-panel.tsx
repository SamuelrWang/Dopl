"use client";

/**
 * STAGING (round 4, 2026-10-26) — the Tasks tab's body: the list (`./task-list.tsx`), or one
 * task's detail (`./task-detail.tsx`) drilled into in place with a breadcrumb back. Which task
 * is open is the SCENE's state (`openId`), like the open thread, so the composer quick view's
 * row lands on that task's detail and "See all" lands on the list. No product counterpart.
 */

import { TaskList, type TaskListProps } from "./task-list";
import { TaskDetail, type TaskDetailProps } from "./task-detail";

export function TaskPanel({
  openId,
  onOpenChange,
  onToggleSubtask,
  onAddNote,
  ...list
}: TaskListProps &
  Pick<TaskDetailProps, "onToggleSubtask" | "onAddNote"> & {
    /** The task whose detail is showing; `null` is the list. */
    openId: string | null;
    onOpenChange: (taskId: string | null) => void;
  }) {
  const open = list.tasks.find((t) => t.id === openId) ?? null;
  if (!open) return <TaskList {...list} onOpen={onOpenChange} />;
  return (
    <TaskDetail
      task={open}
      members={list.members}
      onBack={() => onOpenChange(null)}
      onResolve={list.onResolve}
      onReopen={list.onReopen}
      onOpenLink={list.onOpenLink}
      onToggleSubtask={onToggleSubtask}
      onAddNote={onAddNote}
    />
  );
}

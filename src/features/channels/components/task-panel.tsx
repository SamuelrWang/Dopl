"use client";

import { useMemo } from "react";
import { ArrowRight, ListTodo } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { EmptyState } from "@/shared/ui/empty-state";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import type { ChannelMember, ChannelTask, TaskMode } from "../types";

/** The three rendered task states, mirroring `message-thread.tsx taskOverlayFrom`. */
type TaskDisplayStatus = "active" | "done" | "failed";

const STATUS_LABEL: Record<TaskDisplayStatus, string> = {
  active: "Task active",
  done: "Task complete",
  failed: "Task failed",
};

/** Open task = active; a closed one is failed (outcome) or complete. */
function displayStatus(task: ChannelTask): TaskDisplayStatus {
  if (task.status === "open") return "active";
  return task.outcome === "failed" ? "failed" : "done";
}

interface Props {
  /** The channel's tasks, newest-first (server `created_at DESC`; no re-sort). */
  tasks: ChannelTask[];
  /** True while the first tasks read is still resolving. */
  tasksLoading: boolean;
  /** Channel roster, for resolving creator / target avatars. */
  members: ChannelMember[];
  /** userId -> display name, for the creator / target labels. */
  memberNames: Map<string, string>;
  /** Navigate to the task's grouped card (scroll + transient highlight). */
  onSelectTask: (taskId: string) => void;
}

/**
 * The channel's task list, shown in a header popover (the Bell-popover sibling).
 * Each row carries the task title, its status chip (Task active / complete /
 * failed), a mode badge, the creator and target as small avatars, and the
 * created (plus closed) time. Clicking a row scrolls its grouped card into view
 * and briefly rings it. Renders the shared {@link EmptyState} when the channel
 * has no tasks yet.
 */
export function TaskPanel({
  tasks,
  tasksLoading,
  members,
  memberNames,
  onSelectTask,
}: Props) {
  const memberById = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members]
  );

  const personFor = (userId: string): AvatarPerson => {
    const member = memberById.get(userId);
    return {
      userId,
      email: member?.email ?? null,
      displayName: member?.displayName ?? memberNames.get(userId) ?? null,
      avatarUrl: member?.avatarUrl ?? null,
    };
  };
  const nameFor = (userId: string) =>
    memberById.get(userId)?.displayName ?? memberNames.get(userId) ?? "teammate";

  return (
    <div className="flex max-h-96 flex-col">
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-1">
        <ListTodo size={13} className="shrink-0 text-text-secondary" />
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          Tasks
        </span>
        {tasks.length > 0 && (
          <span className="rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
            {tasks.length}
          </span>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="px-3 py-6">
          {tasksLoading ? (
            <p className="text-center text-caption text-text-muted">
              Loading tasks…
            </p>
          ) : (
            <EmptyState icon={ListTodo} title="No tasks yet." />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto overscroll-contain border-t border-border-subtle">
          {tasks.map((task) => {
            const status = displayStatus(task);
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onSelectTask(task.id)}
                className="flex w-full flex-col gap-1.5 px-3 py-2 text-left transition-colors hover:bg-surface-raised-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-small font-medium text-text-primary">
                    {task.title}
                  </span>
                  <StatusChip status={status} />
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-text-muted">
                  <ModeBadge mode={task.mode} />
                  <span className="flex items-center gap-1">
                    <Avatar person={personFor(task.createdBy)} size="xs" />
                    <span className="truncate">{nameFor(task.createdBy)}</span>
                  </span>
                  {task.targetUserId && (
                    <span className="flex items-center gap-1">
                      <ArrowRight size={11} className="shrink-0" />
                      <Avatar person={personFor(task.targetUserId)} size="xs" />
                      <span className="truncate">{nameFor(task.targetUserId)}</span>
                    </span>
                  )}
                </div>

                <span className="text-micro text-text-muted">
                  {formatChannelTimestamp(task.createdAt)}
                  {task.closedAt &&
                    ` · closed ${formatChannelTimestamp(task.closedAt)}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The task's execution mode as a quiet pill (mirrors the session-card badge). */
function ModeBadge({ mode }: { mode: TaskMode }) {
  return (
    <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
      {mode === "interactive" ? "Interactive" : "Autonomous"}
    </span>
  );
}

/** Compact status chip: danger ink for a failure, success for active/complete. */
function StatusChip({ status }: { status: TaskDisplayStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium",
        status === "failed"
          ? "text-danger"
          : status === "active"
            ? "text-success"
            : "text-text-secondary"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "failed" ? "bg-danger" : "bg-success"
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

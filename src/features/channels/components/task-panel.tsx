"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, ListTodo } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { EmptyState } from "@/shared/ui/empty-state";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import type {
  ChannelMember,
  ChannelMessage,
  ChannelTask,
  TaskMode,
  TaskOutcome,
} from "../types";

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
  /**
   * The latest `task_progress` milestone per task id (derived from the loaded
   * messages), shown as a one-line accomplishment under the title. Absent map
   * or missing entry renders nothing.
   */
  latestMilestone?: Map<string, ChannelMessage>;
  /** Navigate to the task's grouped card (scroll + transient highlight). */
  onSelectTask: (taskId: string) => void;
  /**
   * The viewer's user id — gates the per-row Close / Reopen controls to a task's
   * creator or target. Absent (until the integration pass threads it in) hides
   * the controls entirely.
   */
  currentUserId?: string;
  /** Close a task with an outcome + optional summary. Absent hides Close. */
  onCloseTask?: (
    taskId: string,
    outcome: TaskOutcome,
    summary: string
  ) => Promise<void>;
  /** Reopen a closed task. Absent hides Reopen. */
  onReopenTask?: (taskId: string) => Promise<void>;
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
  latestMilestone,
  onSelectTask,
  currentUserId,
  onCloseTask,
  onReopenTask,
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
            const milestone = latestMilestone?.get(task.id);
            const canManageTask =
              !!currentUserId &&
              (currentUserId === task.createdBy ||
                currentUserId === task.targetUserId);
            return (
              <div key={task.id} className="flex flex-col">
                <button
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

                  {milestone && (
                    <div className="flex items-center gap-1 text-micro text-text-muted">
                      <Check size={11} className="shrink-0 text-success" />
                      <span className="min-w-0 truncate">{milestone.body}</span>
                    </div>
                  )}

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
                        <span className="truncate">
                          {nameFor(task.targetUserId)}
                        </span>
                      </span>
                    )}
                  </div>

                  <span className="text-micro text-text-muted">
                    {formatChannelTimestamp(task.createdAt)}
                    {task.closedAt &&
                      ` · closed ${formatChannelTimestamp(task.closedAt)}`}
                  </span>

                  {task.status === "closed" && task.outcomeSummary && (
                    <span
                      className={cn(
                        "text-caption",
                        task.outcome === "failed"
                          ? "text-danger"
                          : "text-text-secondary"
                      )}
                    >
                      {task.outcomeSummary}
                    </span>
                  )}
                </button>
                {canManageTask && (
                  <TaskRowActions
                    task={task}
                    onCloseTask={onCloseTask}
                    onReopenTask={onReopenTask}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The per-row Close / Reopen control strip, shown under a task row only for its
 * creator or target. An open task gets a Close affordance that expands into an
 * optional summary well plus Mark complete / Mark failed; a closed task gets a
 * single Reopen button. Each direction renders only when its callback is wired
 * (absent until the integration pass). Buttons disable while a write is in
 * flight so a double-click can't fire two writes.
 */
function TaskRowActions({
  task,
  onCloseTask,
  onReopenTask,
}: {
  task: ChannelTask;
  onCloseTask?: (
    taskId: string,
    outcome: TaskOutcome,
    summary: string
  ) => Promise<void>;
  onReopenTask?: (taskId: string) => Promise<void>;
}) {
  const [closing, setClosing] = useState(false);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  if (task.status === "closed") {
    if (!onReopenTask) return null;
    return (
      <div className="flex justify-end px-3 pb-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => onReopenTask(task.id))}
          className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary disabled:opacity-60"
        >
          Reopen task
        </button>
      </div>
    );
  }

  if (!onCloseTask) return null;

  if (!closing) {
    return (
      <div className="flex justify-end px-3 pb-2">
        <button
          type="button"
          onClick={() => setClosing(true)}
          className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary"
        >
          Close task
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2">
      <input
        type="text"
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        disabled={busy}
        maxLength={2000}
        placeholder="Closing summary (optional)"
        className="concave-field w-full rounded-[8px] px-2.5 py-1.5 text-caption text-text-primary placeholder:text-text-muted"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setClosing(false)}
          disabled={busy}
          className="btn-light rounded-[8px] px-2 py-1 text-caption font-medium text-text-secondary disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await onCloseTask(task.id, "failed", summary.trim());
              setClosing(false);
            })
          }
          className="btn-light rounded-[8px] px-2 py-1 text-caption font-medium text-danger disabled:opacity-60"
        >
          Mark failed
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await onCloseTask(task.id, "completed", summary.trim());
              setClosing(false);
            })
          }
          className="btn-light rounded-[8px] px-2 py-1 text-caption font-medium text-text-primary disabled:opacity-60"
        >
          Mark complete
        </button>
      </div>
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

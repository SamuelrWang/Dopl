"use client";

/**
 * STAGING (new 2026-10-26, channel tasks) — THE FULL TASK LIST, the Tasks tab's body
 * (`./tasks-info-panel.tsx`). The composer bar's quick view (`./tasks-popover.tsx`, round 2)
 * is a concise list built from this file's `TaskTick` + `Assignees`. No product
 * counterpart yet. The row is the landing Orchestration "Tasks" window's recipe
 * (`marketing/components/ontology-windows.tsx › TasksWindow`: status tick, title, owner face,
 * status pill), plus what a channel task needs on top: who opened it, who it is assigned to,
 * and the thread or message it came from. CSS: `ui-staging/staging.css › .uis-tk*`.
 *
 * Active tasks (in progress, then open) sit in one card; resolved ones collapse under a
 * "Resolved" toggle. The tick IS the control: it resolves an active task and reopens a
 * resolved one. There is no create form, since agents open tasks.
 */

import { useState } from "react";
import { Check, ChevronRight, Hash, ListChecks, MessageSquare } from "lucide-react";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { IdentityStack } from "@/shared/ui/avatar-stack";
import { EmptyState } from "@/shared/ui/empty-state";
import { IdentityFace, type IdentityRing } from "@/shared/ui/identity-face";
import { StatusPill, type StatusTone } from "@/shared/ui/status-pill";
import type { ChannelMember } from "@/features/channels/types";
import { stagingAgentIndex, stagingIdentityFace } from "../data/staging-agents";
import {
  TASK_STATUS_LABEL,
  isActive,
  subtaskProgress,
  type StagingTask,
  type SubtaskState,
  type TaskActor,
  type TaskLink,
  type TaskStatus,
} from "../data/staging-tasks";

/** `IdentityFace` props for an actor: an agent is ringed in its colour, a person is a plain photo. */
export type ActorFace = {
  name: string;
  photo: string | null;
  ring?: IdentityRing;
  runtimeLogo?: string | null;
};

export function actorFace(actor: TaskActor, members: readonly ChannelMember[]): ActorFace {
  if (actor.kind === "agent") {
    const face = stagingIdentityFace(actor.agentId);
    return {
      name: stagingAgentIndex().get(actor.agentId)?.displayName ?? actor.agentId,
      photo: face.photo,
      runtimeLogo: face.logo,
      ring: face.color ?? "neutral",
    };
  }
  const m = members.find((x) => x.userId === actor.userId);
  return { name: m?.displayName ?? m?.email ?? "Member", photo: m?.avatarUrl ?? null };
}

/** Task statuses and subtask states share the status pill's tones. */
export const STATUS_TONE: Record<TaskStatus | SubtaskState, StatusTone> = {
  open: "neutral",
  todo: "neutral",
  in_progress: "attention",
  resolved: "done",
  done: "done",
};

/** The status tick's face, `.lp-ont-tick`'s three states. */
export function TaskTick({ status }: { status: StagingTask["status"] }) {
  return status === "resolved" ? <Check size={10} strokeWidth={3} aria-hidden="true" /> : null;
}

export function Assignees({
  actors,
  members,
}: {
  actors: readonly TaskActor[];
  members: readonly ChannelMember[];
}) {
  const faces = actors.map((a) => actorFace(a, members));
  return (
    <IdentityStack
      faces={faces.map((f) => ({ key: f.name, ...f }))}
      size={22}
      max={3}
      label={`Assigned to ${faces.map((f) => f.name).join(", ")}`}
    />
  );
}

/** The thread or message a task came from; opens it. Shared with the detail header. */
export function TaskLinkChip({ link, onOpen }: { link: TaskLink; onOpen: (link: TaskLink) => void }) {
  return (
    <button type="button" className="uis-tk-link" onClick={() => onOpen(link)}>
      {link.kind === "thread" ? (
        <Hash size={11} aria-hidden="true" />
      ) : (
        <MessageSquare size={11} aria-hidden="true" />
      )}
      <span>{link.kind === "thread" ? link.label : "Message"}</span>
    </button>
  );
}

/** Round 4: "2/4" subtasks done, beside the status. */
export function TaskProgress({ task }: { task: StagingTask }) {
  const progress = subtaskProgress(task);
  if (!progress) return null;
  return (
    <span
      className="uis-tk-progress"
      role="img"
      aria-label={`${progress.done} of ${progress.total} subtasks done`}
    >
      <ListChecks size={11} aria-hidden="true" />
      {progress.done}/{progress.total}
    </span>
  );
}

export type TaskListProps = {
  tasks: readonly StagingTask[];
  members: readonly ChannelMember[];
  onResolve: (taskId: string) => void;
  onReopen: (taskId: string) => void;
  onOpenLink: (link: TaskLink) => void;
  /** Round 4: open the task's detail view (the title is the control). */
  onOpen?: (taskId: string) => void;
};

function TaskRow({
  task,
  members,
  onResolve,
  onReopen,
  onOpenLink,
  onOpen,
}: { task: StagingTask } & Omit<TaskListProps, "tasks">) {
  const done = task.status === "resolved";
  const creator = actorFace(task.createdBy, members);
  const closer = task.resolvedBy ? actorFace(task.resolvedBy, members) : null;
  const link = task.link;
  return (
    <li className="uis-tk-row" data-status={task.status}>
      <button
        type="button"
        className="uis-tk-tick"
        data-status={task.status}
        aria-label={done ? `Reopen ${task.title}` : `Resolve ${task.title}`}
        title={done ? "Reopen" : "Resolve"}
        onClick={() => (done ? onReopen(task.id) : onResolve(task.id))}
      >
        <TaskTick status={task.status} />
      </button>
      <span className="uis-tk-main">
        {onOpen ? (
          <button
            type="button"
            className="uis-tk-title uis-tk-open"
            aria-label={`Open ${task.title}`}
            onClick={() => onOpen(task.id)}
          >
            {task.title}
          </button>
        ) : (
          <span className="uis-tk-title">{task.title}</span>
        )}
        <span className="uis-tk-meta">
          {done && closer ? (
            <>
              <IdentityFace size={14} {...closer} />
              <span>
                {closer.name} resolved {formatRelativeTime(task.resolvedAt)}
              </span>
            </>
          ) : (
            <>
              <IdentityFace size={14} {...creator} />
              <span>
                {creator.name} opened {formatRelativeTime(task.createdAt)}
              </span>
            </>
          )}
          {link && <TaskLinkChip link={link} onOpen={onOpenLink} />}
        </span>
      </span>
      <span className="uis-tk-side">
        <Assignees actors={task.assignees} members={members} />
        <span className="uis-tk-side-row">
          <TaskProgress task={task} />
          <StatusPill tone={STATUS_TONE[task.status]} dot={false}>
            {TASK_STATUS_LABEL[task.status]}
          </StatusPill>
        </span>
      </span>
    </li>
  );
}

/** In progress first, then open; each group newest first. */
const ORDER = { in_progress: 0, open: 1, resolved: 2 } as const;
export const byOrder = (a: StagingTask, b: StagingTask) =>
  ORDER[a.status] - ORDER[b.status] || b.updatedAt.localeCompare(a.updatedAt);

export function TaskList(props: TaskListProps) {
  const [doneOpen, setDoneOpen] = useState(false);
  const active = props.tasks.filter(isActive).sort(byOrder);
  const done = props.tasks.filter((t) => !isActive(t)).sort(byOrder);
  const row = (t: StagingTask) => <TaskRow key={t.id} task={t} {...props} />;

  if (props.tasks.length === 0) {
    return <EmptyState variant="well" icon={Check} title="No tasks yet" />;
  }

  return (
    <div className="uis-tk-list">
      {active.length > 0 ? (
        <ul className="white-card uis-tk-card" aria-label="Active tasks">
          {active.map(row)}
        </ul>
      ) : (
        <EmptyState variant="well" icon={Check} title="All tasks resolved" />
      )}
      {done.length > 0 && (
        <>
          <button
            type="button"
            className="uis-tk-toggle"
            aria-expanded={doneOpen}
            onClick={() => setDoneOpen((v) => !v)}
          >
            <ChevronRight size={12} aria-hidden="true" data-open={doneOpen ? "true" : "false"} />
            Resolved
            <span className="uis-tk-toggle-count">{done.length}</span>
          </button>
          {doneOpen && (
            <ul className="white-card uis-tk-card" aria-label="Resolved tasks">
              {done.map(row)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

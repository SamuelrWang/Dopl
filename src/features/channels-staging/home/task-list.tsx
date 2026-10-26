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
import { RING_PX, agentColor } from "@/features/onboarding/components/paired-avatar";
import { colorSlot } from "@/features/marketing/components/banner-demo/demo-swap";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { ChannelMember } from "@/features/channels/types";
import { stagingAgentIndex, stagingIdentityFace } from "../data/staging-agents";
import {
  TASK_STATUS_LABEL,
  isActive,
  subtaskProgress,
  type StagingTask,
  type TaskActor,
  type TaskLink,
} from "../data/staging-tasks";

type Face = { name: string; photo: string | null; logo?: string; color: number | null };

export function actorFace(actor: TaskActor, members: readonly ChannelMember[]): Face {
  if (actor.kind === "agent") {
    const face = stagingIdentityFace(actor.agentId);
    return {
      name: stagingAgentIndex().get(actor.agentId)?.displayName ?? actor.agentId,
      photo: face.photo,
      logo: face.logo,
      color: colorSlot(face.color),
    };
  }
  const m = members.find((x) => x.userId === actor.userId);
  return { name: m?.displayName ?? m?.email ?? "Member", photo: m?.avatarUrl ?? null, color: null };
}

/** An agent is its identity face (ringed photo + runtime badge); a person is a plain photo. */
export function TaskFace({ face, d }: { face: Face; d: number }) {
  if (face.color !== null) {
    // Round 6: `PairedAvatar`'s exact recipe (RING_PX colour ring → equal white frame → photo,
    // runtime badge at half size hanging 0.3 × badge past the corner), drawn in SPANS so it is
    // valid inside a `<p>` (the composer's recipients row, the detail meta line). PairedAvatar
    // renders `<div>`s, which React flags there. CSS `.uis-tk-idface*`.
    const ring = agentColor(face.color);
    const b = d * 0.5;
    return (
      <span className="uis-tk-idface" style={{ width: d, height: d }}>
        <span className="uis-tk-idface-ring" style={{ borderWidth: RING_PX, borderColor: ring, padding: RING_PX }}>
          {face.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- staging, static /public photo
            <img src={face.photo} alt="" draggable={false} />
          ) : null}
        </span>
        {face.logo && (
          <span
            className="uis-tk-idface-badge"
            style={{ width: b, height: b, right: -b * 0.3, bottom: -b * 0.3, borderWidth: RING_PX, borderColor: ring }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- staging, static /public logo */}
            <img src={face.logo} alt="" draggable={false} style={{ width: b * 0.58, height: b * 0.58 }} />
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="uis-tk-person" style={{ width: d, height: d }}>
      {face.photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- staging, static /public photo
        <img src={face.photo} alt="" />
      ) : (
        face.name.charAt(0).toUpperCase()
      )}
    </span>
  );
}

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
  const names = faces.map((f) => f.name).join(", ");
  const shown = faces.slice(0, 3);
  return (
    <span className="uis-tk-stack" role="img" aria-label={`Assigned to ${names}`} title={names}>
      {shown.map((f) => (
        <span key={f.name} className="uis-tk-stack-item">
          <TaskFace face={f} d={22} />
        </span>
      ))}
      {faces.length > shown.length && (
        <span className="uis-tk-more">+{faces.length - shown.length}</span>
      )}
    </span>
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
              <TaskFace face={closer} d={14} />
              <span>
                {closer.name} resolved {formatRelativeTime(task.resolvedAt)}
              </span>
            </>
          ) : (
            <>
              <TaskFace face={creator} d={14} />
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
          <span className="uis-tk-status" data-status={task.status}>
            {TASK_STATUS_LABEL[task.status]}
          </span>
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
    return (
      <div className="uis-tk-empty">
        <Check size={14} aria-hidden="true" />
        <span>No tasks yet</span>
      </div>
    );
  }

  return (
    <div className="uis-tk-list">
      {active.length > 0 ? (
        <ul className="uis-tk-card" aria-label="Active tasks">
          {active.map(row)}
        </ul>
      ) : (
        <div className="uis-tk-empty">
          <Check size={14} aria-hidden="true" />
          <span>All tasks resolved</span>
        </div>
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
            <ul className="uis-tk-card" aria-label="Resolved tasks">
              {done.map(row)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

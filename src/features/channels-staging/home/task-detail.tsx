"use client";

/**
 * STAGING (round 4, 2026-10-26, task detail) — ONE TASK, opened from the Tasks tab or the
 * composer quick view, inside the right panel (`./task-panel.tsx` swaps it in for the list).
 * Top to bottom: a breadcrumb back to the list (DESIGN-LANGUAGE §4 "Breadcrumb"), the header,
 * then Subtasks (`./task-subtasks.tsx`) and Notes (`./task-notes.tsx`).
 *
 * THE HEADER, CALMED (round 5, Samuel: "this part looks too jumbled"): title + status pill,
 * the opening agent's description, the subtask meter (round 8: the meta line of opener · opened ·
 * due · updated is removed, Samuel: "i think this can be removed"), then ONE hairline-fenced
 * row: the assignees as an overlapping stack
 * (green presence dot on whoever is active now, names on hover) + the From chip, and
 * Resolve/Reopen at the right. The round-4 facts well and its stacked "Assigned" / "Active now"
 * rows are gone, so nobody is listed twice. No product counterpart yet.
 * CSS `ui-staging/staging.css › .uis-tkd*`.
 */

import { ChevronLeft } from "lucide-react";
import type { ChannelMember } from "@/features/channels/types";
import {
  TASK_STATUS_LABEL,
  activeActors,
  subtaskProgress,
  type StagingTask,
  type TaskActor,
  type TaskLink,
} from "../data/staging-tasks";
import { TaskFace, TaskLinkChip, actorFace } from "./task-list";
import { TaskSubtasks } from "./task-subtasks";
import { TaskNotes } from "./task-notes";

export type TaskDetailProps = {
  task: StagingTask;
  members: readonly ChannelMember[];
  onBack: () => void;
  onResolve: (taskId: string) => void;
  onReopen: (taskId: string) => void;
  onOpenLink: (link: TaskLink) => void;
  onToggleSubtask: (taskId: string, subtaskId: string) => void;
  onAddNote: (taskId: string, text: string) => void;
};

const actorKey = (a: TaskActor) => (a.kind === "agent" ? a.agentId : a.userId);

/** Assignees in one overlapping stack; a green dot marks who is active now. */
function AssigneeStack({ task, members }: { task: StagingTask; members: readonly ChannelMember[] }) {
  const active = new Set(activeActors(task).map(actorKey));
  const people = task.assignees.map((a) => ({
    face: actorFace(a, members),
    active: active.has(actorKey(a)),
  }));
  const names = people.map((p) => (p.active ? `${p.face.name} (active)` : p.face.name)).join(", ");
  return (
    <span className="uis-tkd-stack" role="img" aria-label={`Assigned to ${names}`} title={names}>
      {people.map((p) => (
        <span key={p.face.name} className="uis-tkd-stack-item" data-active={p.active ? "true" : undefined}>
          <TaskFace face={p.face} d={20} />
        </span>
      ))}
      <span className="uis-tkd-stack-label">
        {people.length === 1 ? people[0].face.name : `${people.length} assigned`}
      </span>
    </span>
  );
}

export function TaskDetail({
  task,
  members,
  onBack,
  onResolve,
  onReopen,
  onOpenLink,
  onToggleSubtask,
  onAddNote,
}: TaskDetailProps) {
  const done = task.status === "resolved";
  const progress = subtaskProgress(task);
  return (
    <article className="uis-tkd" aria-label={task.title}>
      <nav className="uis-tkd-crumbs" aria-label="Breadcrumb">
        <button type="button" className="uis-tkd-back" aria-label="Back to tasks" onClick={onBack}>
          <ChevronLeft size={13} aria-hidden="true" />
          Tasks
        </button>
        <span aria-hidden="true">›</span>
        <span className="uis-tkd-crumb-current">{task.title}</span>
      </nav>

      <header className="uis-tkd-head">
        <div className="uis-tkd-title-row">
          <h3 className="uis-tkd-title">{task.title}</h3>
          <span className="uis-tk-status" data-status={task.status}>
            {TASK_STATUS_LABEL[task.status]}
          </span>
        </div>
        {task.description && <p className="uis-tkd-desc">{task.description}</p>}
        {progress && (
          <div className="uis-tkd-progress">
            <span className="uis-tkd-meter" aria-hidden="true">
              <i style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </span>
            <span role="img" aria-label={`${progress.done} of ${progress.total} subtasks done`}>
              {progress.done}/{progress.total}
            </span>
          </div>
        )}
        <div className="uis-tkd-row">
          <AssigneeStack task={task} members={members} />
          {task.link && <TaskLinkChip link={task.link} onOpen={onOpenLink} />}
          <button
            type="button"
            className="uis-st-pill uis-tkd-resolve"
            onClick={() => (done ? onReopen(task.id) : onResolve(task.id))}
          >
            {done ? "Reopen" : "Resolve"}
          </button>
        </div>
      </header>

      <TaskSubtasks
        subtasks={task.subtasks}
        members={members}
        onToggle={(id) => onToggleSubtask(task.id, id)}
      />
      <TaskNotes notes={task.notes} members={members} onAdd={(text) => onAddNote(task.id, text)} />
    </article>
  );
}

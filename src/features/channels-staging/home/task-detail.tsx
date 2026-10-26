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
import { IdentityStack } from "@/shared/ui/avatar-stack";
import { Breadcrumb } from "@/shared/ui/breadcrumb";
import { StatusPill } from "@/shared/ui/status-pill";
import { PILL_BUTTON } from "@/shared/ui/small-action-button";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { cn } from "@/shared/lib/utils";
import type { ChannelMember } from "@/features/channels/types";
import {
  TASK_STATUS_LABEL,
  activeActors,
  subtaskProgress,
  type StagingTask,
  type TaskActor,
  type TaskLink,
} from "../data/staging-tasks";
import { STATUS_TONE, TaskLinkChip, actorFace } from "./task-list";
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
  const faces = task.assignees.map((a) => ({
    ...actorFace(a, members),
    online: active.has(actorKey(a)),
  }));
  const names = faces.map((f) => (f.online ? `${f.name} (active)` : f.name)).join(", ");
  return (
    <span className="uis-tkd-stack">
      <IdentityStack
        faces={faces.map((f) => ({ key: f.name, ...f }))}
        size={20}
        label={`Assigned to ${names}`}
      />
      <span className="uis-tkd-stack-label">
        {faces.length === 1 ? faces[0].name : `${faces.length} assigned`}
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
      <Breadcrumb
        items={[
          {
            key: "tasks",
            label: "Tasks",
            icon: <ChevronLeft size={13} aria-hidden="true" />,
            onSelect: onBack,
            ariaLabel: "Back to tasks",
          },
          { key: task.id, label: task.title },
        ]}
      />

      <header className="uis-tkd-head">
        <div className="uis-tkd-title-row">
          <h3 className="uis-tkd-title">{task.title}</h3>
          <StatusPill tone={STATUS_TONE[task.status]} dot={false}>
            {TASK_STATUS_LABEL[task.status]}
          </StatusPill>
        </div>
        {task.description && <p className="uis-tkd-desc">{task.description}</p>}
        {progress && (
          <div className="uis-tkd-progress">
            <ThinMeter used={progress.done} limit={progress.total} className="flex-1" />
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
            className={cn(PILL_BUTTON, "ml-auto h-5.5 py-0")}
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

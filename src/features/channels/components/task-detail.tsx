"use client";

import { ChevronLeft, TriangleAlert } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Breadcrumb } from "@/shared/ui/breadcrumb";
import { EmptyState } from "@/shared/ui/empty-state";
import { StatusPill } from "@/shared/ui/status-pill";
import { PILL_BUTTON } from "@/shared/ui/small-action-button";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { actorKey } from "../lib/task-model";
import { TaskAssignees, TaskLinkChip, nextStatus } from "./task-bits";
import { STATUS_TONE, TASK_STATUS_LABEL, type TaskFaceOf } from "./task-faces";
import { TaskNotes } from "./task-notes";
import { TaskSubtasks } from "./task-subtasks";
import type {
  ChannelTask,
  ChannelTaskDetail,
  ChannelTaskSubtask,
  TaskLink,
  TaskStatus,
} from "../types";

export interface TaskDetailProps {
  /** The list's row: the header paints from it while the detail read is in flight. */
  task: ChannelTask;
  detail: ChannelTaskDetail | null;
  /** The detail read failed: the subtasks and notes are unknown, not empty. */
  failed?: boolean;
  faceOf: TaskFaceOf;
  onBack: () => void;
  onOpenLink: (link: TaskLink) => void;
  /** Absent (a guest) draws no Resolve / Reopen and no subtask checks. */
  onSetStatus?: (task: ChannelTask, status: TaskStatus) => void;
  onToggleSubtask?: (task: ChannelTaskDetail, subtask: ChannelTaskSubtask) => void;
  onAddNote: (taskId: string, body: string) => Promise<unknown>;
}

function Assignees({ task, faceOf }: { task: ChannelTask; faceOf: TaskFaceOf }) {
  const { assignees } = task;
  if (assignees.length === 0) return null;
  return (
    <span className="inline-flex h-5.5 flex-none items-center">
      <TaskAssignees
        actors={assignees}
        faceOf={faceOf}
        active={new Set(task.active.map(actorKey))}
      />
      <span className="ml-2 whitespace-nowrap text-caption text-text-secondary">
        {assignees.length === 1 ? faceOf(assignees[0]).name : `${assignees.length} assigned`}
      </span>
    </span>
  );
}

/** One task inside the Tasks tab: breadcrumb, header, subtasks, notes. */
export function TaskDetail({
  task: row,
  detail,
  failed = false,
  faceOf,
  onBack,
  onOpenLink,
  onSetStatus,
  onToggleSubtask,
  onAddNote,
}: TaskDetailProps) {
  const task = detail ?? row;
  const next = nextStatus(task);
  return (
    <article aria-label={task.title} className="flex min-w-0 flex-col gap-5">
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

      <header className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2.5">
          <h3 className="text-title font-semibold leading-[1.3] text-text-primary">{task.title}</h3>
          <StatusPill tone={STATUS_TONE[task.status]} dot={false}>
            {TASK_STATUS_LABEL[task.status]}
          </StatusPill>
        </div>
        {task.description && (
          <p className="whitespace-pre-wrap text-body leading-normal text-text-secondary">
            {task.description}
          </p>
        )}
        {task.progress && (
          <div className="flex items-center gap-2 text-caption tabular-nums text-text-muted">
            <ThinMeter used={task.progress.done} limit={task.progress.total} className="flex-1" />
            <span
              role="img"
              aria-label={`${task.progress.done} of ${task.progress.total} subtasks done`}
            >
              {task.progress.done}/{task.progress.total}
            </span>
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2.5 border-t border-border-default pt-2.5">
          <Assignees task={task} faceOf={faceOf} />
          {task.link && (
            <TaskLinkChip
              link={task.link}
              onOpen={onOpenLink}
              className="h-5.5 flex-[0_1_auto] px-2 text-caption leading-[22px]"
            />
          )}
          {onSetStatus && (
            <button
              type="button"
              onClick={() => onSetStatus(task, next.status)}
              className={cn(PILL_BUTTON, "ml-auto h-5.5 py-0")}
            >
              {next.verb}
            </button>
          )}
        </div>
      </header>

      {!detail && failed && (
        <EmptyState
          variant="well"
          icon={TriangleAlert}
          title="Could not load this task's subtasks and notes"
        />
      )}
      {detail && (
        <>
          <TaskSubtasks
            subtasks={detail.subtasks}
            faceOf={faceOf}
            onToggle={onToggleSubtask && ((s) => onToggleSubtask(detail, s))}
          />
          <TaskNotes
            notes={detail.notes}
            truncated={detail.notesTruncated}
            faceOf={faceOf}
            onAdd={(body) => onAddNote(detail.id, body)}
          />
        </>
      )}
    </article>
  );
}

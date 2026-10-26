"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, ChevronDown, ListChecks, TriangleAlert } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { IdentityStack } from "@/shared/ui/avatar-stack";
import { EmptyState } from "@/shared/ui/empty-state";
import { NAKED_ICON, NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { TEXT_LINK_BUTTON } from "@/shared/ui/text-link";
import { byTaskOrder, isActiveTask } from "../lib/task-model";
import { TASK_TICK, TaskAssignees, TaskTickMark } from "./task-bits";
import { workingTaskFaces, type TaskFaceOf } from "./task-faces";
import type { ChannelTask } from "../types";

/** Escape, or a press outside both the pill and the pop-up, closes it. */
function useLightDismiss(
  open: boolean,
  setOpen: (open: boolean) => void,
  pill: RefObject<HTMLElement | null>,
  popup: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!pill.current?.contains(target) && !popup.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, setOpen, pill, popup]);
}

/**
 * THE TASKS QUICK VIEW — a "N tasks" pill at the right end of the composer's recipient line, and
 * a concise pop-up of the ACTIVE tasks opening upward from it. A row, or "See all", opens the info
 * column on the Tasks tab (a row on that task's detail). Mounted in `composer-recipients.tsx ›
 * ComposerRecipients`'s `trailing` slot, whose right edge is the composer card's, so the pill and
 * the pop-up share it. Hidden only while the channel is known to have no tasks.
 */
export function TasksQuickView({
  tasks,
  failed = false,
  faceOf,
  onOpenTask,
}: {
  tasks: readonly ChannelTask[];
  /** The tasks read failed: the pill stays, without a count, and the pop-up says so. */
  failed?: boolean;
  faceOf: TaskFaceOf;
  /** Open the Tasks tab: a task id lands on its detail, `null` on the list. */
  onOpenTask: (taskId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const pill = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLElement>(null);
  useLightDismiss(open, setOpen, pill, popup);

  const unknown = failed && tasks.length === 0;
  if (tasks.length === 0 && !unknown) return null;
  const active = tasks.filter(isActiveTask).sort(byTaskOrder);
  const faces = workingTaskFaces(tasks, faceOf);
  const go = (taskId: string | null) => {
    setOpen(false);
    onOpenTask(taskId);
  };

  return (
    <>
      <button
        ref={pill}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-7.5 flex-none items-center gap-1.75 whitespace-nowrap rounded-full border border-border-default bg-bg-overlay pr-3 text-caption font-medium text-text-primary shadow-[var(--shadow-bento)] transition-colors hover:bg-bg-elevated-hover aria-expanded:bg-bg-elevated-hover",
          faces.length > 0 ? "pl-1.5" : "pl-2.75"
        )}
      >
        {faces.length > 0 ? (
          <IdentityStack faces={faces} size={18} />
        ) : (
          <ListChecks size={13} aria-hidden="true" />
        )}
        {unknown ? "Tasks" : active.length === 1 ? "1 task" : `${active.length} tasks`}
      </button>
      {open && (
        <section
          ref={popup}
          aria-label="Tasks"
          className="white-card absolute bottom-full right-0 z-20 mb-1 flex max-h-80 w-75 flex-col"
        >
          <header className="flex h-9.5 flex-none items-center gap-1.5 border-b border-border-default pl-3 pr-1">
            <span className="text-body font-semibold text-text-primary">Tasks</span>
            {!unknown && <span className="text-caption text-text-muted">{active.length}</span>}
            <button
              type="button"
              onClick={() => go(null)}
              className={cn(TEXT_LINK_BUTTON, "ml-auto px-1 text-caption font-medium text-text-primary")}
            >
              See all
            </button>
            <button
              type="button"
              aria-label="Hide tasks"
              onClick={() => setOpen(false)}
              className={NAKED_ICON_BUTTON}
            >
              <ChevronDown size={NAKED_ICON} aria-hidden="true" />
            </button>
          </header>
          {unknown ? (
            <EmptyState variant="well" icon={TriangleAlert} title="Could not load tasks" className="m-2" />
          ) : active.length > 0 ? (
            <ul aria-label="Active tasks, quick view" className="m-0 min-h-0 list-none overflow-y-auto p-1">
              {active.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => go(t.id)}
                    className="grid min-h-8.5 w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-raised-1"
                  >
                    <span data-status={t.status} aria-hidden="true" className={TASK_TICK}>
                      <TaskTickMark status={t.status} />
                    </span>
                    <span className="truncate text-caption text-text-primary">{t.title}</span>
                    <TaskAssignees actors={t.assignees} faceOf={faceOf} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState variant="well" icon={Check} title="All tasks resolved" className="m-2" />
          )}
        </section>
      )}
    </>
  );
}

"use client";

import { Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { IdentityFace } from "@/shared/ui/identity-face";
import { StatusPill } from "@/shared/ui/status-pill";
import { TASK_CARD } from "./task-list";
import { STATUS_TONE, SUBTASK_STATE_LABEL, type TaskFaceOf } from "./task-faces";
import type { ChannelTaskSubtask } from "../types";

/** The square check: empty, or filled ink when done. */
const CHECK =
  "grid size-4 flex-none place-items-center rounded-[5px] border-[1.5px] border-[var(--raised-light-line)] " +
  "text-text-on-invert transition-colors data-[state=done]:border-text-primary data-[state=done]:bg-text-primary";

export const TASK_SECTION_TITLE =
  "inline-flex items-baseline gap-1.5 text-body font-semibold text-text-primary";
export const TASK_SECTION_COUNT = "text-caption font-normal tabular-nums text-text-muted";

/** The agents' ordered breakdown of a task. The check toggles done ↔ to do; absent (a guest) is a mark. */
export function TaskSubtasks({
  subtasks,
  faceOf,
  onToggle,
}: {
  subtasks: readonly ChannelTaskSubtask[];
  faceOf: TaskFaceOf;
  onToggle?: (subtask: ChannelTaskSubtask) => void;
}) {
  if (subtasks.length === 0) return null;
  const done = subtasks.filter((s) => s.state === "done").length;
  return (
    <section aria-label="Subtasks" className="flex min-w-0 flex-col gap-2">
      <h4 className={TASK_SECTION_TITLE}>
        Subtasks
        <span className={TASK_SECTION_COUNT}>
          {done}/{subtasks.length}
        </span>
      </h4>
      <ol className={TASK_CARD}>
        {subtasks.map((s) => {
          const owner = s.owner ? faceOf(s.owner) : null;
          const checked = s.state === "done";
          const mark = checked && <Check size={10} strokeWidth={3} aria-hidden="true" />;
          return (
            <li
              key={s.id}
              data-state={s.state}
              className="grid min-h-11 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-border-default py-1.75 first:border-t-0"
            >
              {onToggle ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={s.title}
                  data-state={s.state}
                  onClick={() => onToggle(s)}
                  className={cn(CHECK, "hover:border-text-primary")}
                >
                  {mark}
                </button>
              ) : (
                <span data-state={s.state} aria-hidden="true" className={CHECK}>
                  {mark}
                </span>
              )}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cn(
                    "text-body",
                    checked ? "text-text-muted line-through" : "text-text-primary"
                  )}
                >
                  {s.title}
                </span>
                {s.detail && (
                  <span className="truncate text-label text-text-muted">{s.detail}</span>
                )}
              </span>
              <span className="inline-flex items-center gap-2">
                {!checked && (
                  <StatusPill tone={STATUS_TONE[s.state]} dot={false}>
                    {SUBTASK_STATE_LABEL[s.state]}
                  </StatusPill>
                )}
                {owner && (
                  <span title={owner.name}>
                    <IdentityFace size={20} {...owner} label={`Owner ${owner.name}`} />
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

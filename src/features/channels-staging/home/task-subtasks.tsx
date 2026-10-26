"use client";

/**
 * STAGING (round 4, 2026-10-26) — a task's SUBTASKS: the agents' ordered breakdown, one white
 * card with a hairline between rows (the Tasks list's recipe). Each row: a check (the control;
 * done ↔ to do, in memory), title, optional one-line detail, owner face, state pill when not
 * done. No product counterpart yet. CSS `ui-staging/staging.css › .uis-tkd-sub*`.
 */

import { Check } from "lucide-react";
import { IdentityFace } from "@/shared/ui/identity-face";
import { StatusPill } from "@/shared/ui/status-pill";
import type { ChannelMember } from "@/features/channels/types";
import { SUBTASK_STATE_LABEL, type StagingSubtask } from "../data/staging-tasks";
import { STATUS_TONE, actorFace } from "./task-list";

export function TaskSubtasks({
  subtasks,
  members,
  onToggle,
}: {
  subtasks: readonly StagingSubtask[];
  members: readonly ChannelMember[];
  onToggle: (subtaskId: string) => void;
}) {
  if (subtasks.length === 0) return null;
  const done = subtasks.filter((s) => s.state === "done").length;
  return (
    <section className="uis-tkd-section" aria-label="Subtasks">
      <h4 className="uis-tkd-section-title">
        Subtasks
        <span className="uis-tkd-section-count">
          {done}/{subtasks.length}
        </span>
      </h4>
      <ol className="white-card uis-tk-card">
        {subtasks.map((s) => {
          const owner = actorFace(s.owner, members);
          const checked = s.state === "done";
          return (
            <li key={s.id} className="uis-tkd-sub" data-state={s.state}>
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                aria-label={s.title}
                className="uis-tkd-check"
                data-state={s.state}
                onClick={() => onToggle(s.id)}
              >
                {checked && <Check size={10} strokeWidth={3} aria-hidden="true" />}
              </button>
              <span className="uis-tkd-sub-main">
                <span className="uis-tkd-sub-title">{s.title}</span>
                {s.detail && <span className="uis-tkd-sub-detail">{s.detail}</span>}
              </span>
              <span className="uis-tkd-sub-side">
                {!checked && (
                  <StatusPill tone={STATUS_TONE[s.state]} dot={false}>
                    {SUBTASK_STATE_LABEL[s.state]}
                  </StatusPill>
                )}
                <span title={owner.name}>
                  <IdentityFace size={20} {...owner} label={`Owner ${owner.name}`} />
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

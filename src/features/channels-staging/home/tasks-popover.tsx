"use client";

/**
 * STAGING (channel tasks; round 2, 2026-10-26) — THE QUICK VIEW: a small "4 tasks" pill at the
 * right end of the composer's "agents working" line, opening a concise pop-up of the ACTIVE
 * tasks (tick + title + assignee faces). A row, or "See all", opens the right panel on the
 * Tasks tab (`./tasks-info-panel.tsx`), which is the full view. Hide (or the pill again) folds
 * the pop-up away. No product counterpart yet.
 *
 * WHERE IT SITS: the scene hands {@link StagingTasksBar} to `ChannelsMessagePane` as its
 * `agentActivity` node, so it renders inside the product's `composer-recipients.tsx` row (the
 * line above the composer card), wrapping the product's `AgentActivityRows`: the agent pills
 * take what room is left and elide, the tasks pill sits at the row's right end. CSS
 * (`ui-staging/staging.css › .uis-tk-bar*`) lets that row's working slot grow and pulls the
 * pill 2px right, onto the card's right edge (the row carries `px-0.5`, the card does not).
 * The pop-up is portalled to a host parked at the END of the composer wrapper (`relative`,
 * `px-4`), so it opens upward from the pill with its right edge on the card's right edge, and
 * no list markup lands inside the row's `<p>`.
 * Port = an `agentActivity`-like slot on the recipients row's right end, plus the pop-up.
 */

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ListChecks } from "lucide-react";
import type { ChannelMember } from "@/features/channels/types";
import { isActive, type StagingTask } from "../data/staging-tasks";
import {
  Assignees,
  TaskFace,
  TaskTick,
  actorFace,
  byOrder,
  type TaskListProps,
} from "./task-list";

/** Faces of whoever is on in-progress work (agents and people), at most three, for the pill. */
function workingFaces(tasks: readonly StagingTask[], members: readonly ChannelMember[]) {
  const seen = new Set<string>();
  const out: ReturnType<typeof actorFace>[] = [];
  for (const t of tasks) {
    if (t.status !== "in_progress") continue;
    for (const a of t.assignees) {
      const key = a.kind === "agent" ? a.agentId : a.userId;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(actorFace(a, members));
    }
  }
  return out.slice(0, 3);
}

const RECIPIENTS = 'p[aria-label="Recipients"]';
const AGENT_VIEW = 'aside[aria-label="Agent view"]';

/** A host at the end of the channel composer's wrapper (`composer.tsx`, `relative px-4`). */
function useComposerHost(paneRef: RefObject<HTMLElement | null>): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const root = paneRef.current;
    if (!root) return;
    const el = document.createElement("div");
    el.className = "uis-tk-pop-anchor";
    const seat = () => {
      const row = [...root.querySelectorAll(RECIPIENTS)].find((p) => !p.closest(AGENT_VIEW));
      const wrapper = row?.parentElement;
      // Last child, so the demo's `[aria-label="Recipients"] + .raised-tab` rules still match.
      if (wrapper && wrapper.lastElementChild !== el) wrapper.append(el);
    };
    seat();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: the host exists now
    setHost(el);
    const mo = new MutationObserver(seat);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      el.remove();
    };
  }, [paneRef]);
  return host;
}

export function StagingTasksBar({
  paneRef,
  working,
  tasks,
  members,
  onOpenTask,
}: Pick<TaskListProps, "tasks" | "members"> & {
  paneRef: RefObject<HTMLElement | null>;
  /** The product's `AgentActivityRows`, unchanged. */
  working: ReactNode;
  /** Open the right panel on the Tasks tab: a task id opens its detail, `null` the list. */
  onOpenTask: (taskId: string | null) => void;
}) {
  const host = useComposerHost(paneRef);
  const [open, setOpen] = useState(false);
  const active = tasks.filter(isActive).sort(byOrder);
  const label = active.length === 1 ? "1 task" : `${active.length} tasks`;
  const faces = workingFaces(tasks, members);
  const go = (taskId: string | null) => {
    setOpen(false);
    onOpenTask(taskId);
  };

  return (
    <span className="uis-tk-bar">
      <span className="uis-tk-bar-working">{working}</span>
      {tasks.length > 0 && (
        <button
          type="button"
          className="uis-tk-pill"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {/* Round 3 (Samuel, 2026-10-26: "make the pill look like it used to"): round 1's face. */}
          {faces.length > 0 ? (
            <span className="uis-tk-stack" aria-hidden="true">
              {faces.map((f) => (
                <span key={f.name} className="uis-tk-stack-item">
                  <TaskFace face={f} d={18} />
                </span>
              ))}
            </span>
          ) : (
            <ListChecks size={13} aria-hidden="true" />
          )}
          <span>{label}</span>
        </button>
      )}
      {open &&
        host &&
        createPortal(
          <section className="uis-tk-pop" aria-label="Tasks">
            <header className="uis-tk-pop-head">
              <span className="uis-tk-pop-title">Tasks</span>
              <span className="uis-tk-pop-count">{active.length}</span>
              <button type="button" className="uis-tk-pop-all" onClick={() => go(null)}>
                See all
              </button>
              <button
                type="button"
                className="uis-tk-pop-hide"
                aria-label="Hide tasks"
                onClick={() => setOpen(false)}
              >
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </header>
            {active.length > 0 ? (
              <ul className="uis-tk-quick" aria-label="Active tasks, quick view">
                {active.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="uis-tk-qrow" onClick={() => go(t.id)}>
                      <span className="uis-tk-tick" data-status={t.status} aria-hidden="true">
                        <TaskTick status={t.status} />
                      </span>
                      <span className="uis-tk-qtitle">{t.title}</span>
                      <Assignees actors={t.assignees} members={members} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="uis-tk-empty">All tasks resolved</p>
            )}
          </section>,
          host
        )}
    </span>
  );
}

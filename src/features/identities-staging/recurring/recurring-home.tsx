"use client";

import { useState, type ReactNode } from "react";
import { Repeat } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { CreateButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { toast } from "@/shared/ui/toast";
import { IdentityRailResizeHandle } from "@/features/agent-identities/components/identity-rail-resize";
import {
  IDENTITY_GRID_RAIL,
  IdentityPanel,
} from "@/features/agent-identities/components/identity-section";
import {
  SECTIONS_CONTAINER,
  SECTION_PRIVATE_EVERYWHERE,
} from "@/features/agent-identities/lib/visibility";
import { nameOf } from "../data-agents";
import { SEED_RECURRING_TASKS, type RecurringTask } from "../data/recurring-tasks";
import { latency } from "../store/identity-store";
import { RecurringCard, RecurringRing, RecurringStack } from "./recurring-card";
import { RecurringDetailDialog } from "./recurring-detail-dialog";
import { RecurringEditorDialog } from "./recurring-editor-dialog";
import { launchedRun, latestRun, nextRunFor } from "./recurring-model";

/** One row of the rail: ring, title, one meta line, then the faces. */
const RAIL_ROW =
  "white-card card-lift flex w-full min-w-0 cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left";

/**
 * STAGING MOCKUP of the Identities page's Recurring tasks view: saved task templates in the
 * identity face's two sections, each with subtasks bound to identities, a Launch button and an
 * optional schedule. The rail shows what is running now and what starts next. Local state only.
 */
export function RecurringHome({
  channelName,
  currentUserId,
}: {
  /** `null` = no channel selected: no shared section, nothing to launch into. */
  channelName: string | null;
  currentUserId: string;
}) {
  const [tasks, setTasks] = useState<RecurringTask[]>(SEED_RECURRING_TASKS);
  const [starting, setStarting] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ task: RecurringTask | null } | null>(null);

  const visible = channelName ? tasks : tasks.filter((t) => t.scope === "home");
  const shared = visible.filter((t) => t.scope === "shared");
  const personal = visible.filter((t) => t.scope === "home");
  const running = visible.filter((t) => latestRun(t)?.result === "running");
  const upNext = visible.filter((t) => t.nextRun && latestRun(t)?.result !== "running");
  const viewing = tasks.find((t) => t.id === viewingId);

  const markerFor = (task: RecurringTask) =>
    task.createdBy === currentUserId ? null : `by ${nameOf(task.createdBy) ?? "a member"}`;
  const scopeLabel = (task: RecurringTask) =>
    task.scope === "shared" ? SECTIONS_CONTAINER[0].label : SECTION_PRIVATE_EVERYWHERE.label;
  const update = (id: string, patch: (t: RecurringTask) => RecurringTask) =>
    setTasks((all) => all.map((t) => (t.id === id ? patch(t) : t)));

  async function launch(task: RecurringTask) {
    if (!channelName) return;
    setStarting(task.id);
    await latency(900);
    setStarting(null);
    update(task.id, (t) => ({ ...t, runs: [launchedRun(t), ...t.runs] }));
    const n = new Set(task.subtasks.map((s) => s.identityId)).size;
    toast({
      title: `"${task.title}" launched into #${channelName} with ${n} ${n === 1 ? "identity" : "identities"}`,
      variant: "invert",
    });
  }

  const grid = (rows: RecurringTask[], emptyLine: string) =>
    rows.length === 0 ? (
      <p className="pb-1 text-caption text-text-muted">{emptyLine}</p>
    ) : (
      <div className={IDENTITY_GRID_RAIL}>
        {rows.map((task) => (
          <RecurringCard
            key={task.id}
            task={task}
            marker={markerFor(task)}
            launch={channelName ? (starting === task.id ? "starting" : "idle") : null}
            onOpen={() => setViewingId(task.id)}
            onLaunch={() => void launch(task)}
          />
        ))}
      </div>
    );

  const railRow = (task: RecurringTask, meta: ReactNode) => (
    <button key={task.id} type="button" onClick={() => setViewingId(task.id)} className={RAIL_ROW}>
      <RecurringRing task={task} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 truncate text-small font-semibold text-text-primary">{task.title}</span>
        <span className="min-w-0 truncate text-caption text-text-muted">{meta}</span>
      </span>
      <RecurringStack task={task} size="s" />
    </button>
  );

  return (
    <div className="rail-layout">
      <div className="rail-layout-cols">
        <div className="rail-layout-main">
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <p className="flex-none text-caption text-text-muted">
              {visible.length} recurring {visible.length === 1 ? "task" : "tasks"}
            </p>
            <div className="ml-auto flex-none">
              <CreateButton onClick={() => setEditing({ task: null })}>Recurring task</CreateButton>
            </div>
          </div>

          {channelName === null ? (
            <EmptyState icon={Repeat} title="No channel selected" />
          ) : (
            <IdentityPanel id="home-recurring-shared" label={SECTIONS_CONTAINER[0].label} flat>
              {grid(shared, "No recurring tasks shared in this channel yet.")}
            </IdentityPanel>
          )}
          <IdentityPanel id="home-recurring-private" label={SECTION_PRIVATE_EVERYWHERE.label} flat>
            {grid(personal, "You haven't saved a recurring task yet.")}
          </IdentityPanel>
        </div>

        <IdentityRailResizeHandle />
        <aside className="rail-layout-aside" aria-label="Schedule">
          <IdentityPanel id="home-recurring-running" label="Running now" flat>
            {running.length === 0 ? (
              <p className="pb-1 text-caption text-text-muted">Nothing is running right now.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {running.map((task) => {
                  const run = latestRun(task)!;
                  return railRow(
                    task,
                    <span className="flex items-center gap-1.5">
                      <StatusPill dot tone="live" bare>
                        {`${run.done}/${run.total}`}
                      </StatusPill>
                      <span className="truncate">{`${run.startedBy} · ${run.when}`}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </IdentityPanel>
          <IdentityPanel id="home-recurring-next" label="Up next" flat>
            {upNext.length === 0 ? (
              <p className="pb-1 text-caption text-text-muted">No runs are scheduled.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {upNext.map((task) => railRow(task, task.nextRun))}
              </div>
            )}
          </IdentityPanel>
        </aside>
      </div>

      {viewing && (
        <RecurringDetailDialog
          task={viewing}
          marker={markerFor(viewing)}
          scopeLabel={scopeLabel(viewing)}
          canLaunch={channelName !== null}
          onLaunch={() => {
            setViewingId(null);
            void launch(viewing);
          }}
          onEdit={() => {
            setViewingId(null);
            setEditing({ task: viewing });
          }}
          onToggleSchedule={(on) =>
            update(viewing.id, (t) => {
              const schedule = { ...t.schedule, on };
              return { ...t, schedule, nextRun: nextRunFor(schedule) };
            })
          }
          onClose={() => setViewingId(null)}
        />
      )}
      {editing && (
        <RecurringEditorDialog
          task={editing.task}
          createdBy={currentUserId}
          onClose={() => setEditing(null)}
          onSave={(saved) => {
            setTasks((all) =>
              all.some((t) => t.id === saved.id)
                ? all.map((t) => (t.id === saved.id ? saved : t))
                : [...all, saved]
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

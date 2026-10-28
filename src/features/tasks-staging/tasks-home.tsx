"use client";

import { Fragment, useState } from "react";
import { Pencil, Play, Repeat } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CreateButton } from "@/shared/ui/pill-button";
import {
  OPEN_SCALE_ICON_ONLY,
  OpenScaleIconButton,
} from "@/shared/ui/open-scale-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { toast } from "@/shared/ui/toast";
import { IdentityRailResizeHandle } from "@/features/agent-identities/components/identity-rail-resize";
import { IdentityPanel } from "@/features/agent-identities/components/identity-section";
import { ROW_CARD, ROW_CARD_ROW } from "@/features/channels/components/bits";
import { nameOf } from "@/features/identities-staging/data-agents";
import { latency } from "@/features/identities-staging/store/identity-store";
import {
  AGENDA_DAYS,
  NOW_LABEL,
  NOW_MINUTES,
  SEED_AGENDA,
  minutesOf,
  type AgendaEntry,
} from "./data/agenda";
import { STAGING_TASK_CHANNELS, channelName } from "./data/channels";
import { SEED_SAVED_TASKS, type SavedTask } from "./data/saved-tasks";
import { AgendaRow, NowRule } from "./components/agenda-row";
import { AssignmentFaces } from "./components/assignee";
import { DESKTOP_ONLY_LINE, launchedRun, latestRun, nextRunFor, scheduleLabel } from "./model/schedule";
import { SavedTaskDetail } from "./saved/saved-task-detail";
import { SavedTaskEditor } from "./saved/saved-task-editor";

type Scope = "all" | string;

/**
 * STAGING MOCKUP of the Tasks page (Samuel, 2026-10-28: the agenda spine). Left: Today,
 * Tomorrow, This week and Anytime down a time line, each one-off task and each saved-task run on
 * its hour, missed runs flagged on the line with Run now. Right: the saved-task library, each
 * launchable and editable from the rail. A channel filter scopes both. Local state only.
 */
export function TasksHome({ currentUserId }: { currentUserId: string }) {
  const [scope, setScope] = useState<Scope>("all");
  const [agenda, setAgenda] = useState<AgendaEntry[]>(SEED_AGENDA);
  const [saved, setSaved] = useState<SavedTask[]>(SEED_SAVED_TASKS);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ task: SavedTask | null } | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const inScope = (channelId: string) => scope === "all" || scope === channelId;
  const entries = agenda.filter((e) => inScope(e.channelId));
  const library = saved.filter((t) => inScope(t.channelId));
  const viewing = saved.find((t) => t.id === viewingId);
  const savedOf = (entry: AgendaEntry) => saved.find((t) => t.id === entry.savedTaskId);
  const markerFor = (task: SavedTask) =>
    task.createdBy === currentUserId ? null : `by ${nameOf(task.createdBy) ?? "a member"}`;
  const update = (id: string, patch: (t: SavedTask) => SavedTask) =>
    setSaved((all) => all.map((t) => (t.id === id ? patch(t) : t)));

  async function launch(task: SavedTask, replacing?: AgendaEntry) {
    setStarting(task.id);
    await latency(900);
    setStarting(null);
    const fresh = launchedRun(task);
    update(task.id, (t) => ({ ...t, runs: [fresh, ...t.runs] }));
    const run: AgendaEntry = {
      id: `ag-${fresh.id}`,
      day: "today",
      time: NOW_LABEL,
      title: task.title,
      channelId: task.channelId,
      savedTaskId: task.id,
      state: "running",
      progress: { done: 0, total: task.steps.length },
      assignment: task.assignment,
      note: "Launched by you",
    };
    setAgenda((all) => [...all.filter((e) => e.id !== replacing?.id), run]);
    toast({ title: `"${task.title}" launched into #${channelName(task.channelId)}`, variant: "invert" });
  }

  const dayRows = (day: (typeof AGENDA_DAYS)[number]["key"]) => {
    const rows = entries
      .filter((e) => e.day === day)
      .sort((a, b) => (a.time && b.time ? minutesOf(a.time) - minutesOf(b.time) : 0));
    const nowAt = day === "today" ? rows.findIndex((e) => e.time && minutesOf(e.time) > NOW_MINUTES) : -1;
    return { rows, nowAt: nowAt === -1 && day === "today" ? rows.length : nowAt };
  };

  return (
    <div className="rail-layout">
      <div className="rail-layout-cols">
        <div className="rail-layout-main">
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <SegmentedControl
              variant="track"
              options={[
                { key: "all", label: "All channels" },
                ...STAGING_TASK_CHANNELS.map((c) => ({ key: c.id, label: `#${c.name}` })),
              ]}
              value={scope}
              onChange={setScope}
              ariaLabel="Channel"
              className="flex-none"
            />
            <p className="ml-auto flex-none text-caption text-text-muted">
              {`${entries.filter((e) => e.state === "missed").length} missed · ${entries.filter((e) => e.state === "running").length} running · ${entries.filter((e) => e.state === "needs_you").length} need you`}
            </p>
          </div>

          {AGENDA_DAYS.map((day) => {
            const { rows, nowAt } = dayRows(day.key);
            return (
              <IdentityPanel key={day.key} id={`tasks-${day.key}`} label={day.label} flat>
                {day.date && <p className="-mt-1 pb-1 text-caption text-text-muted">{day.date}</p>}
                {rows.length === 0 ? (
                  <p className="pb-1 text-caption text-text-muted">Nothing here.</p>
                ) : (
                  <ul aria-label={day.label} className={ROW_CARD}>
                    {rows.map((entry, i) => {
                      const task = savedOf(entry);
                      return (
                        <Fragment key={entry.id}>
                          {i === nowAt && <NowRule label={NOW_LABEL} />}
                          <AgendaRow
                            entry={entry}
                            scheduleLine={task ? scheduleLabel(task.schedule) : null}
                            assignmentFor={(e) => savedOf(e) ?? { assignment: e.assignment, steps: [] }}
                            onOpen={() =>
                              task
                                ? setViewingId(task.id)
                                : toast({ title: `Staging: would open "${entry.title}"` })
                            }
                            onRunNow={task ? () => void launch(task, entry) : undefined}
                          />
                        </Fragment>
                      );
                    })}
                    {nowAt === rows.length && <NowRule label={NOW_LABEL} />}
                  </ul>
                )}
              </IdentityPanel>
            );
          })}
        </div>

        <IdentityRailResizeHandle />
        <aside className="rail-layout-aside" aria-label="Saved tasks">
          <IdentityPanel
            id="tasks-saved"
            label="Saved tasks"
            flat
            action={<CreateButton onClick={() => setEditing({ task: null })}>Saved task</CreateButton>}
          >
            {library.length === 0 ? (
              <p className="pb-1 text-caption text-text-muted">No saved tasks in this channel yet.</p>
            ) : (
              <ul aria-label="Saved task library" className={ROW_CARD}>
                {library.map((task) => {
                  const running = latestRun(task)?.result === "running";
                  return (
                    <li key={task.id} className={cn(ROW_CARD_ROW, "flex min-w-0 items-center gap-2.5 py-2.5")}>
                      <button
                        type="button"
                        onClick={() => setViewingId(task.id)}
                        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 text-left"
                      >
                        <span className="min-w-0 truncate text-small font-semibold text-text-primary">
                          {task.title}
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-1 text-label text-text-muted">
                          <Repeat size={11} strokeWidth={2} aria-hidden="true" className="flex-none" />
                          <span className="truncate">{scheduleLabel(task.schedule)}</span>
                        </span>
                        <AssignmentFaces task={task} size="xs" />
                      </button>
                      <OpenScaleIconButton
                        aria-label={`Edit ${task.title}`}
                        onClick={() => setEditing({ task })}
                      >
                        <Pencil size={OPEN_SCALE_ICON_ONLY} strokeWidth={2} aria-hidden="true" />
                      </OpenScaleIconButton>
                      <OpenScaleIconButton
                        aria-label={`Launch ${task.title}`}
                        disabled={running || starting === task.id}
                        onClick={() => void launch(task)}
                        className="disabled:opacity-60"
                      >
                        <Play size={OPEN_SCALE_ICON_ONLY} strokeWidth={2} aria-hidden="true" />
                      </OpenScaleIconButton>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="pt-2 text-caption text-text-muted">{`${DESKTOP_ONLY_LINE}.`}</p>
          </IdentityPanel>
        </aside>
      </div>

      {viewing && (
        <SavedTaskDetail
          task={viewing}
          marker={markerFor(viewing)}
          scopeLabel={viewing.scope === "shared" ? "Shared in this channel" : "Personal"}
          canLaunch
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
        <SavedTaskEditor
          task={editing.task}
          createdBy={currentUserId}
          defaultChannelId={scope === "all" ? STAGING_TASK_CHANNELS[0].id : scope}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            setSaved((all) =>
              all.some((t) => t.id === next.id) ? all.map((t) => (t.id === next.id ? next : t)) : [...all, next]
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

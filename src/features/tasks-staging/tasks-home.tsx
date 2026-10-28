"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { CreateButton } from "@/shared/ui/pill-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { toast } from "@/shared/ui/toast";
import { IdentityPanel } from "@/features/agent-identities/components/identity-section";
import { nameOf } from "@/features/identities-staging/data-agents";
import { latency } from "@/features/identities-staging/store/identity-store";
import { STAGING_TASK_CHANNELS, channelName } from "./data/channels";
import { SEED_SAVED_TASKS, type SavedTask } from "./data/saved-tasks";
import { TaskCard } from "./components/task-card";
import styles from "./tasks.module.css";
import { WeekBar } from "./components/week-bar";
import {
  DESKTOP_ONLY_LINE,
  launchedRun,
  latestRun,
  nextRunFor,
} from "./model/schedule";
import { NOW_LABEL, TODAY_INDEX, weekChips, type WeekChip } from "./model/week";
import { SavedTaskDetail } from "./saved/saved-task-detail";
import { SavedTaskEditor } from "./saved/saved-task-editor";

type Scope = "all" | string;

type Group = "needs" | "repeating" | "oneoff";

const GROUPS: ReadonlyArray<{
  key: Group;
  label: string;
  empty: string;
  caption?: string;
}> = [
  { key: "needs", label: "Needs you", empty: "Nothing is waiting on you." },
  {
    key: "repeating",
    label: "Repeating",
    empty: "No repeating tasks here yet.",
    caption: `${DESKTOP_ONLY_LINE}.`,
  },
  { key: "oneoff", label: "One-off", empty: "No one-off tasks here yet." },
];

/** Needs you = a run waits on a person, or a scheduled run was missed and wants Run now. */
function groupOf(task: SavedTask): Group {
  const result = latestRun(task)?.result;
  if (result === "needs_you" || result === "missed") return "needs";
  return task.schedule.on ? "repeating" : "oneoff";
}

/**
 * STAGING MOCKUP of the Tasks page (Samuel, 2026-10-28, second shape): a compact week bar on
 * top, each day's runs as chips; below, every task as a compact card in Needs you, Repeating and
 * One-off. A chip or a row opens the same task view. A channel filter scopes both. Local state.
 */
export function TasksHome({ currentUserId }: { currentUserId: string }) {
  const [scope, setScope] = useState<Scope>("all");
  const [tasks, setTasks] = useState<SavedTask[]>(SEED_SAVED_TASKS);
  const [offset, setOffset] = useState(0);
  const [launched, setLaunched] = useState<WeekChip[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ task: SavedTask | null } | null>(
    null,
  );
  const [starting, setStarting] = useState<string | null>(null);

  const visible = tasks.filter((t) => scope === "all" || t.channelId === scope);
  const visibleIds = new Set(visible.map((t) => t.id));
  const chips = [
    ...weekChips(visible, offset),
    ...(offset === 0 ? launched.filter((c) => visibleIds.has(c.taskId)) : []),
  ];
  const viewing = tasks.find((t) => t.id === viewingId);
  const markerFor = (task: SavedTask) =>
    task.createdBy === currentUserId
      ? null
      : `by ${nameOf(task.createdBy) ?? "a member"}`;
  const update = (id: string, patch: (t: SavedTask) => SavedTask) =>
    setTasks((all) => all.map((t) => (t.id === id ? patch(t) : t)));

  async function launch(task: SavedTask) {
    setStarting(task.id);
    await latency(900);
    setStarting(null);
    const run = launchedRun(task);
    update(task.id, (t) => ({ ...t, runs: [run, ...t.runs] }));
    setLaunched((all) => [
      ...all,
      {
        id: `0:${run.id}`,
        taskId: task.id,
        dayIndex: TODAY_INDEX,
        time: NOW_LABEL,
        title: task.title,
        state: "running",
      },
    ]);
    toast({
      title: `"${task.title}" launched into #${channelName(task.channelId)}`,
      variant: "invert",
    });
  }

  return (
    <div className="rail-layout">
      <div className="rail-layout-cols" data-rail="off">
        <div className="rail-layout-main">
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <SegmentedControl
              variant="track"
              options={[
                { key: "all", label: "All channels", count: tasks.length },
                ...STAGING_TASK_CHANNELS.map((c) => ({
                  key: c.id,
                  label: `#${c.name}`,
                  count: tasks.filter((t) => t.channelId === c.id).length,
                })),
              ]}
              value={scope}
              onChange={setScope}
              ariaLabel="Channel"
              className="flex-none"
            />
            <div className="ml-auto flex-none">
              <CreateButton onClick={() => setEditing({ task: null })}>
                Task
              </CreateButton>
            </div>
          </div>

          <WeekBar
            chips={chips}
            offset={offset}
            onOffset={setOffset}
            onOpen={(chip) => setViewingId(chip.taskId)}
          />

          {GROUPS.map((group) => {
            const rows = visible.filter((t) => groupOf(t) === group.key);
            return (
              <IdentityPanel
                key={group.key}
                id={`tasks-${group.key}`}
                label={group.label}
                flat
              >
                {group.caption && rows.length > 0 && (
                  <p className="pb-1 text-caption text-text-muted">
                    {group.caption}
                  </p>
                )}
                {rows.length === 0 ? (
                  <p className="pb-1 text-caption text-text-muted">
                    {group.empty}
                  </p>
                ) : (
                  <ul
                    aria-label={group.label}
                    className={cn(styles.cards, "m-0 list-none p-0")}
                  >
                    {rows.map((task) => (
                      <li key={task.id} className="flex min-w-0">
                        <TaskCard
                          task={task}
                          starting={starting === task.id}
                          onOpen={() => setViewingId(task.id)}
                          onLaunch={() => void launch(task)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </IdentityPanel>
            );
          })}
        </div>
      </div>

      {viewing && (
        <SavedTaskDetail
          task={viewing}
          marker={markerFor(viewing)}
          scopeLabel={
            viewing.scope === "shared" ? "Shared in this channel" : "Personal"
          }
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
          defaultChannelId={
            scope === "all" ? STAGING_TASK_CHANNELS[0].id : scope
          }
          onClose={() => setEditing(null)}
          onSave={(next) => {
            setTasks((all) =>
              all.some((t) => t.id === next.id)
                ? all.map((t) => (t.id === next.id ? next : t))
                : [...all, next],
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Pencil, Play, Repeat, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import { SegmentedControl, segmentedIds } from "@/shared/ui/segmented-control";
import { StatusPill } from "@/shared/ui/status-pill";
import { Switch } from "@/shared/ui/switch";
import {
  Empty,
  EventRow,
  Fact,
  Facts,
  Group,
  Prose,
  Rows,
} from "@/features/agent-identities/components/identity-view-parts";
import styles from "@/features/agent-identities/components/identity-view.module.css";
import { channelName } from "../data/channels";
import type { SavedTask } from "../data/saved-tasks";
import { AssignmentFaces, IdentityMark, StepOwner, TeamChip } from "../components/assignee";
import { assignedTeam, identityOf, splitLine } from "../model/assignment";
import { DESKTOP_ONLY_LINE, MISSED_LINE, RUN_RESULT, latestRun, scheduleLabel } from "../model/schedule";

type TabKey = "steps" | "runs";

const PANEL_IDS = "saved-task-view";

/**
 * THE SAVED TASK VIEW, in the identity view's chrome: a fixed head, underline tabs, a body that
 * alone scrolls. Steps shows who the task goes to and each step's owner (pinned or "Agents
 * decide"); Runs lists every start, scheduled, launched or missed.
 */
export function SavedTaskDetail({
  task,
  marker,
  scopeLabel,
  canLaunch,
  onLaunch,
  onEdit,
  onToggleSchedule,
  onClose,
}: {
  task: SavedTask;
  marker: string | null;
  scopeLabel: string;
  canLaunch: boolean;
  onLaunch: () => void;
  onEdit: () => void;
  onToggleSchedule: (on: boolean) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("steps");
  const ids = segmentedIds(PANEL_IDS, tab);
  const running = latestRun(task)?.result === "running";
  const team = assignedTeam(task);
  const split = splitLine(task);

  return (
    <ModalShell open onClose={onClose} label={task.title} size="panel">
      <div className={styles.head}>
        <AssignmentFaces task={task} size="l" />
        <div className={styles.headText}>
          <h2 className="min-w-0 truncate text-display font-semibold text-text-primary">{task.title}</h2>
          <p className={cn(styles.headMeta, "text-caption text-text-muted")}>
            <Repeat size={12} strokeWidth={2} className="flex-none" aria-hidden="true" />
            <span className="truncate">{scheduleLabel(task.schedule)}</span>
            <span className="text-text-disabled">·</span>
            <span className="truncate">{`#${channelName(task.channelId)}`}</span>
            <span className="text-text-disabled">·</span>
            <span className="truncate">{marker ?? "Yours"}</span>
            <span className="text-text-disabled">·</span>
            <span className="truncate">{scopeLabel}</span>
          </p>
        </div>
        <OpenScaleButton onClick={onEdit} className="flex-none gap-1.5">
          <Pencil size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
          Edit
        </OpenScaleButton>
        {canLaunch && (
          <OpenScaleButton
            onClick={onLaunch}
            disabled={running}
            className="flex-none gap-1.5 disabled:opacity-60"
          >
            <Play size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
            Launch
          </OpenScaleButton>
        )}
        <button type="button" onClick={onClose} className={styles.close} aria-label="Close saved task">
          <X size="s" />
        </button>
      </div>

      <SegmentedControl
        variant="underline"
        options={[
          { key: "steps", label: "Steps", count: task.steps.length },
          { key: "runs", label: "Runs", count: task.runs.length },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel="Saved task sections"
        panelIdPrefix={PANEL_IDS}
        className="flex-none border-b border-border-default px-5"
      />

      <div className={styles.body} role="tabpanel" id={ids.panel} aria-labelledby={ids.tab}>
        {tab === "steps" ? (
          <>
            <Group label="What it is for">
              <Prose>{task.description}</Prose>
            </Group>
            <Group label="Schedule" hint={task.schedule.on ? DESKTOP_ONLY_LINE : undefined}>
              <Facts>
                <Fact label="Repeats" value={scheduleLabel(task.schedule)} />
                <Fact label="Next run" value={task.nextRun ?? "Not scheduled"} />
                <Fact label="Last run" value={latestRun(task)?.when ?? "Never"} />
                <Fact
                  label="On schedule"
                  value={
                    <Switch
                      checked={task.schedule.on}
                      onChange={onToggleSchedule}
                      aria-label="Run on a schedule"
                    />
                  }
                />
              </Facts>
            </Group>
            <Group label="Assigned to" hint="optional">
              {team ? (
                <span className="flex flex-col items-start gap-1.5">
                  <TeamChip teamId={team.id} />
                </span>
              ) : task.assignment.kind === "identities" ? (
                <Rows>
                  {task.assignment.identityIds.map((id) => (
                    <EventRow
                      key={id}
                      lead={<IdentityMark id={id} size="m" />}
                      title={identityOf(id)?.name ?? "Deleted identity"}
                    />
                  ))}
                </Rows>
              ) : (
                <Prose>Nobody yet. Launch asks who should take it.</Prose>
              )}
              {split && <p className="text-caption text-text-muted">{split}</p>}
            </Group>
            <Group label="Steps" hint="in order">
              <Rows>
                {task.steps.map((step, i) => (
                  <EventRow
                    key={step.id}
                    lead={
                      <span className="flex size-5 flex-none items-center justify-center rounded-full bg-bg-inset text-micro font-semibold tabular-nums text-text-secondary">
                        {i + 1}
                      </span>
                    }
                    title={step.title}
                    trail={<StepOwner step={step} />}
                  />
                ))}
              </Rows>
            </Group>
          </>
        ) : task.runs.length === 0 ? (
          <Group label="Runs">
            <Empty>This task has not run yet.</Empty>
          </Group>
        ) : (
          <Group label="Runs" hint="newest first">
            <Rows>
              {task.runs.map((run) => {
                const result = RUN_RESULT[run.result];
                return (
                  <EventRow
                    key={run.id}
                    title={run.when}
                    middle={run.result === "missed" ? MISSED_LINE : run.startedBy}
                    trail={
                      <span className="flex items-center gap-2">
                        <span className="text-caption tabular-nums text-text-muted">
                          {`${run.done}/${run.total}`}
                        </span>
                        <StatusPill dot={run.result === "running"} tone={result.tone}>
                          {result.label}
                        </StatusPill>
                      </span>
                    }
                  />
                );
              })}
            </Rows>
          </Group>
        )}
      </div>
    </ModalShell>
  );
}

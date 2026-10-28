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
import type { RecurringTask } from "../data/recurring-tasks";
import { SlotFace } from "../teams/team-faces";
import { identityOf } from "../teams/team-model";
import { RecurringStack } from "./recurring-card";
import { RUN_RESULT, latestRun, scheduleLabel } from "./recurring-model";

type TabKey = "subtasks" | "runs";

const PANEL_IDS = "recurring-view";

/**
 * THE RECURRING TASK VIEW, in the identity view's chrome: a fixed head, underline tabs, a body
 * that alone scrolls. Subtasks lists each step with the identity that works it; Runs lists every
 * start, scheduled or launched, with how far it got.
 */
export function RecurringDetailDialog({
  task,
  marker,
  scopeLabel,
  canLaunch,
  onLaunch,
  onEdit,
  onToggleSchedule,
  onClose,
}: {
  task: RecurringTask;
  marker: string | null;
  scopeLabel: string;
  canLaunch: boolean;
  onLaunch: () => void;
  onEdit: () => void;
  onToggleSchedule: (on: boolean) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("subtasks");
  const ids = segmentedIds(PANEL_IDS, tab);
  const running = latestRun(task)?.result === "running";
  const lead = identityOf(task.leadId);

  return (
    <ModalShell open onClose={onClose} label={task.title} size="panel">
      <div className={styles.head}>
        <RecurringStack task={task} size="l" />
        <div className={styles.headText}>
          <h2 className="min-w-0 truncate text-display font-semibold text-text-primary">{task.title}</h2>
          <p className={cn(styles.headMeta, "text-caption text-text-muted")}>
            <Repeat size={12} strokeWidth={2} className="flex-none" aria-hidden="true" />
            <span className="truncate">{scheduleLabel(task.schedule)}</span>
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
        <button type="button" onClick={onClose} className={styles.close} aria-label="Close recurring task">
          <X size="s" />
        </button>
      </div>

      <SegmentedControl
        variant="underline"
        options={[
          { key: "subtasks", label: "Subtasks", count: task.subtasks.length },
          { key: "runs", label: "Runs", count: task.runs.length },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel="Recurring task sections"
        panelIdPrefix={PANEL_IDS}
        className="flex-none border-b border-border-default px-5"
      />

      <div className={styles.body} role="tabpanel" id={ids.panel} aria-labelledby={ids.tab}>
        {tab === "subtasks" ? (
          <>
            <Group label="What it is for">
              <Prose>{task.description}</Prose>
            </Group>
            <Group label="Schedule">
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
            <Group label="Lead" hint="owns the task and reports when it is done">
              <Rows>
                <EventRow
                  lead={<SlotFace identityId={task.leadId} size="m" />}
                  title={lead?.name ?? "Deleted identity"}
                  middle={lead?.description ?? undefined}
                />
              </Rows>
            </Group>
            <Group label="Subtasks" hint="one identity each">
              <Rows>
                {task.subtasks.map((sub, i) => (
                  <EventRow
                    key={sub.id}
                    lead={
                      <span className="flex size-5 flex-none items-center justify-center rounded-full bg-bg-inset text-micro font-semibold tabular-nums text-text-secondary">
                        {i + 1}
                      </span>
                    }
                    title={sub.title}
                    trail={
                      <span className="flex items-center gap-1.5 text-caption text-text-muted">
                        <SlotFace identityId={sub.identityId} size="s" />
                        {identityOf(sub.identityId)?.name ?? "Deleted identity"}
                      </span>
                    }
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
                    middle={run.startedBy}
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

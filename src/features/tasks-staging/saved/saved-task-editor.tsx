"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  FormDialog,
  FormSection,
  InlineUnderlineField,
  PillChoice,
  UnderlineField,
} from "@/shared/ui/form-dialog";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SelectMenu } from "@/shared/ui/select-menu";
import { Switch } from "@/shared/ui/switch";
import { STAGING_TASK_CHANNELS } from "../data/channels";
import {
  WEEKDAYS,
  type RecurringFrequency,
  type RecurringSchedule,
  type SavedStep,
  type SavedTask,
  type Weekday,
} from "../data/saved-tasks";
import { AssigneePicker, IdentityMark } from "../components/assignee";
import { UNPINNED_CHIP, pinOptions, splitLine } from "../model/assignment";
import { DESKTOP_ONLY_LINE, nextRunFor, timeLabel } from "../model/schedule";

const FREQUENCY_OPTIONS: ReadonlyArray<{ key: RecurringFrequency; label: string }> = [
  { key: "daily", label: "Every day" },
  { key: "weekdays", label: "Weekdays" },
  { key: "weekly", label: "Weekly" },
];

const DAY_OPTIONS = WEEKDAYS.map((d) => ({ key: d, label: d }));

const TIME_OPTIONS = Array.from({ length: 14 }, (_, i) => {
  const value = `${String(i + 7).padStart(2, "0")}:00`;
  return { value, label: timeLabel(value) };
});

const CHANNEL_OPTIONS = STAGING_TASK_CHANNELS.map((c) => ({ value: c.id, label: `#${c.name}` }));

/** The pin menu's "nobody in particular" value. */
const UNPINNED = "unpinned";

const MAX_STEPS = 8;

let nextId = 0;
const freshId = (prefix: string) => `${prefix}-new-${(nextId += 1)}`;

const blankStep = (): SavedStep => ({ id: freshId("step"), title: "", pinnedIdentityId: null });

function blankTask(createdBy: string, channelId: string): SavedTask {
  return {
    id: freshId("st"),
    title: "",
    description: "",
    scope: "home",
    channelId,
    createdBy,
    assignment: { kind: "none" },
    steps: [blankStep()],
    schedule: { on: false, frequency: "weekly", day: "Mon", time: "09:00" },
    nextRun: null,
    runs: [],
  };
}

/**
 * STAGED EDITOR: the popup form kit over local state. Only the title is required: assignment,
 * pins and the schedule are all optional (Samuel, 2026-10-28). Empty steps are dropped on save.
 */
export function SavedTaskEditor({
  task,
  createdBy,
  defaultChannelId,
  onSave,
  onClose,
}: {
  /** `null` = a new saved task. */
  task: SavedTask | null;
  createdBy: string;
  defaultChannelId: string;
  onSave: (task: SavedTask) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SavedTask>(() => task ?? blankTask(createdBy, defaultChannelId));
  const schedule = draft.schedule;
  const split = splitLine(draft);
  const pins = [
    { value: UNPINNED, label: UNPINNED_CHIP },
    ...pinOptions(draft).map((i) => ({ value: i.id, label: i.name })),
  ];

  const setSchedule = (patch: Partial<RecurringSchedule>) =>
    setDraft((d) => ({ ...d, schedule: { ...d.schedule, ...patch } }));
  const setStep = (id: string, patch: Partial<SavedStep>) =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const ready = draft.title.trim() !== "";

  return (
    <FormDialog
      open
      onDiscard={onClose}
      title={task ? "Edit saved task" : "New saved task"}
      primary={{
        label: task ? "Save" : "Create",
        disabled: !ready,
        hint: ready ? undefined : "Give the task a title.",
        onClick: () =>
          onSave({
            ...draft,
            steps: draft.steps.filter((s) => s.title.trim() !== ""),
            nextRun: nextRunFor(draft.schedule),
          }),
      }}
    >
      <UnderlineField
        id="saved-task-title"
        label="Title"
        ariaLabel="Saved task title"
        placeholder="Monday digest"
        value={draft.title}
        onChange={(title) => setDraft((d) => ({ ...d, title }))}
        autoFocus
      />
      <UnderlineField
        id="saved-task-description"
        label="Description"
        ariaLabel="Saved task description"
        value={draft.description}
        onChange={(description) => setDraft((d) => ({ ...d, description }))}
        multiline
      />

      <FormSection label="Channel" caption="where it runs">
        <SelectMenu
          value={draft.channelId}
          options={CHANNEL_OPTIONS}
          onChange={(channelId) => setDraft((d) => ({ ...d, channelId }))}
          ariaLabel="Channel"
          variant="bare"
        />
      </FormSection>

      <FormSection label="Assign to" caption="optional">
        <span className="flex min-w-0 flex-col items-start gap-1">
          <AssigneePicker
            value={draft.assignment}
            onChange={(assignment) => setDraft((d) => ({ ...d, assignment }))}
          />
          {split && <span className="text-caption text-text-muted">{split}</span>}
        </span>
      </FormSection>

      <FormSection label="Steps" caption="pin an identity or let the agents decide">
        <ol className="flex flex-col gap-2">
          {draft.steps.map((step, i) => (
            <li key={step.id} className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-5 flex-none items-center justify-center rounded-full bg-bg-inset text-micro font-semibold tabular-nums text-text-secondary">
                {i + 1}
              </span>
              <InlineUnderlineField
                label="Step title"
                value={step.title}
                onChange={(title) => setStep(step.id, { title })}
                className="min-w-0 flex-1"
              />
              {step.pinnedIdentityId && <IdentityMark id={step.pinnedIdentityId} size="s" />}
              <SelectMenu
                value={step.pinnedIdentityId ?? UNPINNED}
                options={pins}
                onChange={(v) => setStep(step.id, { pinnedIdentityId: v === UNPINNED ? null : v })}
                ariaLabel={`Who does step ${i + 1}`}
                variant="bare"
              />
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, steps: d.steps.filter((s) => s.id !== step.id) }))}
                aria-label={`Remove step ${i + 1}`}
                className="flex size-6 flex-none cursor-pointer items-center justify-center rounded-md text-text-muted hover:text-text-primary"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ol>
        {draft.steps.length < MAX_STEPS && (
          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, blankStep()] }))}
            className="flex cursor-pointer items-center gap-1.5 self-start text-caption font-medium text-text-secondary hover:text-text-primary"
          >
            <Plus size={13} aria-hidden="true" />
            Add step
          </button>
        )}
      </FormSection>

      <FormSection label="Repeat" caption={DESKTOP_ONLY_LINE}>
        <span className="flex items-center gap-2.5">
          <Switch
            checked={schedule.on}
            onChange={(on) => setSchedule({ on })}
            aria-label="Run on a schedule"
          />
          <span className="text-caption text-text-secondary">
            {schedule.on ? "Runs on a schedule" : "Only when you press Launch"}
          </span>
        </span>
      </FormSection>

      {schedule.on && (
        <>
          <PillChoice
            label="How often"
            options={FREQUENCY_OPTIONS}
            value={schedule.frequency}
            onChange={(frequency) => setSchedule({ frequency })}
            ariaLabel="How often"
          />
          {schedule.frequency === "weekly" && (
            <FormSection label="Day">
              <SegmentedControl
                options={DAY_OPTIONS}
                value={schedule.day}
                onChange={(day: Weekday) => setSchedule({ day })}
                variant="plain"
                size="md"
                className="flex-wrap"
                ariaLabel="Day of the week"
              />
            </FormSection>
          )}
          <FormSection label="Time" caption="your time zone">
            <SelectMenu
              value={schedule.time}
              options={TIME_OPTIONS}
              onChange={(time) => setSchedule({ time })}
              ariaLabel="Start time"
              variant="bare"
            />
          </FormSection>
        </>
      )}
    </FormDialog>
  );
}

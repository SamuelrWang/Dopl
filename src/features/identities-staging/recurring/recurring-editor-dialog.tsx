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
import { SEED_IDENTITIES } from "../data";
import {
  WEEKDAYS,
  type RecurringFrequency,
  type RecurringSchedule,
  type RecurringSubtask,
  type RecurringTask,
  type Weekday,
} from "../data/recurring-tasks";
import { SlotFace } from "../teams/team-faces";
import { nextRunFor, scheduleLabel, timeLabel } from "./recurring-model";

const IDENTITY_OPTIONS = SEED_IDENTITIES.map((i) => ({ value: i.id, label: i.name }));

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

/** A template runs at most this many subtasks (one agent each). */
const MAX_SUBTASKS = 6;

let nextId = 0;
const freshId = (prefix: string) => `${prefix}-new-${(nextId += 1)}`;

function blankSubtask(identityId = "id-coder"): RecurringSubtask {
  return { id: freshId("sub"), title: "", identityId };
}

function blankTask(createdBy: string): RecurringTask {
  return {
    id: freshId("rt"),
    title: "",
    description: "",
    scope: "home",
    createdBy,
    leadId: "id-chief",
    subtasks: [blankSubtask()],
    schedule: { on: false, frequency: "weekly", day: "Mon", time: "09:00" },
    nextRun: null,
    runs: [],
  };
}

/**
 * STAGED EDITOR: the popup form kit over local state. Title, the identity that leads the task,
 * the subtasks (each bound to one identity), and the schedule. Save hands the task back; nothing
 * is written.
 */
export function RecurringEditorDialog({
  task,
  createdBy,
  onSave,
  onClose,
}: {
  /** `null` = a new template. */
  task: RecurringTask | null;
  createdBy: string;
  onSave: (task: RecurringTask) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<RecurringTask>(() => task ?? blankTask(createdBy));
  const schedule = draft.schedule;

  const setSchedule = (patch: Partial<RecurringSchedule>) =>
    setDraft((d) => ({ ...d, schedule: { ...d.schedule, ...patch } }));
  const setSubtask = (id: string, patch: Partial<RecurringSubtask>) =>
    setDraft((d) => ({
      ...d,
      subtasks: d.subtasks.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  const addSubtask = () =>
    setDraft((d) => ({ ...d, subtasks: [...d.subtasks, blankSubtask("id-writer")] }));
  const removeSubtask = (id: string) =>
    setDraft((d) => ({ ...d, subtasks: d.subtasks.filter((s) => s.id !== id) }));

  const full = draft.subtasks.length >= MAX_SUBTASKS;
  const ready =
    draft.title.trim() !== "" &&
    draft.subtasks.length > 0 &&
    draft.subtasks.every((s) => s.title.trim() !== "");

  return (
    <FormDialog
      open
      onDiscard={onClose}
      title={task ? "Edit recurring task" : "New recurring task"}
      primary={{
        label: task ? "Save" : "Create",
        disabled: !ready,
        hint: ready ? undefined : "Give the task and every subtask a title.",
        onClick: () => onSave({ ...draft, nextRun: nextRunFor(draft.schedule) }),
      }}
    >
      <UnderlineField
        id="recurring-title"
        label="Title"
        ariaLabel="Recurring task title"
        placeholder="Monday digest"
        value={draft.title}
        onChange={(title) => setDraft((d) => ({ ...d, title }))}
        autoFocus
      />
      <UnderlineField
        id="recurring-description"
        label="Description"
        ariaLabel="Recurring task description"
        value={draft.description}
        onChange={(description) => setDraft((d) => ({ ...d, description }))}
        multiline
      />

      <FormSection label="Lead" caption="owns the task">
        <span className="flex min-w-0 items-center gap-2.5">
          <SlotFace identityId={draft.leadId} size="m" />
          <SelectMenu
            value={draft.leadId}
            options={IDENTITY_OPTIONS}
            onChange={(leadId) => setDraft((d) => ({ ...d, leadId }))}
            ariaLabel="Lead identity"
            variant="bare"
          />
        </span>
      </FormSection>

      <FormSection label="Subtasks" caption={`${draft.subtasks.length} of ${MAX_SUBTASKS}`}>
        <ol className="flex flex-col gap-2">
          {draft.subtasks.map((sub, i) => (
            <li key={sub.id} className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-5 flex-none items-center justify-center rounded-full bg-bg-inset text-micro font-semibold tabular-nums text-text-secondary">
                {i + 1}
              </span>
              <InlineUnderlineField
                label="Subtask title"
                value={sub.title}
                onChange={(title) => setSubtask(sub.id, { title })}
                className="min-w-0 flex-1"
              />
              <SlotFace identityId={sub.identityId} size="s" />
              <SelectMenu
                value={sub.identityId}
                options={IDENTITY_OPTIONS}
                onChange={(identityId) => setSubtask(sub.id, { identityId })}
                ariaLabel={`Identity for subtask ${i + 1}`}
                variant="bare"
              />
              <button
                type="button"
                onClick={() => removeSubtask(sub.id)}
                aria-label={`Remove subtask ${i + 1}`}
                disabled={draft.subtasks.length === 1}
                className="flex size-6 flex-none cursor-pointer items-center justify-center rounded-md text-text-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ol>
        {!full && (
          <button
            type="button"
            onClick={addSubtask}
            className="flex cursor-pointer items-center gap-1.5 self-start text-caption font-medium text-text-secondary hover:text-text-primary"
          >
            <Plus size={13} aria-hidden="true" />
            Add subtask
          </button>
        )}
      </FormSection>

      <FormSection label="Repeat" caption={scheduleLabel(schedule)}>
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

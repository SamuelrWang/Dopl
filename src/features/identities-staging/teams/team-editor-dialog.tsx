"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  FormDialog,
  FormSection,
  InlineUnderlineField,
  UnderlineField,
} from "@/shared/ui/form-dialog";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SelectMenu } from "@/shared/ui/select-menu";
import { SEED_IDENTITIES } from "../data";
import type {
  StagingAgentTeam,
  StagingTeamSlot,
  StagingTeamStep,
} from "../data/agent-teams";
import { SlotFace } from "./team-faces";

const SEAT_OPTIONS = [
  { key: "1", label: "×1" },
  { key: "2", label: "×2" },
  { key: "3", label: "×3" },
] as const;

const IDENTITY_OPTIONS = SEED_IDENTITIES.map((i) => ({ value: i.id, label: i.name }));

/** The cap a run holds to (PROPOSAL §6 defaults): five agents, three seats per slot. */
const MAX_AGENTS = 5;

let nextId = 0;
const freshId = (prefix: string) => `${prefix}-new-${(nextId += 1)}`;

function blankTeam(createdBy: string): StagingAgentTeam {
  const slot: StagingTeamSlot = { id: freshId("slot"), identityId: "id-coder", label: "Coder", seats: 1 };
  return {
    id: freshId("team"),
    name: "",
    description: "",
    scope: "home",
    createdBy,
    slots: [slot],
    templates: [
      {
        id: freshId("tpl"),
        title: "",
        description: "",
        steps: [{ slotId: slot.id, title: "", instructions: "" }],
      },
    ],
  };
}

/**
 * STAGED EDITOR: the popup form kit over local state. Name, members (identity, label, seats) and
 * the first task template's steps, one per member. Save hands the team back; nothing is written.
 */
export function TeamEditorDialog({
  team,
  createdBy,
  onSave,
  onClose,
}: {
  /** `null` = a new team. */
  team: StagingAgentTeam | null;
  createdBy: string;
  onSave: (team: StagingAgentTeam) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<StagingAgentTeam>(() => team ?? blankTeam(createdBy));
  const template = draft.templates[0];
  const seats = draft.slots.reduce((n, s) => n + s.seats, 0);

  const setSlot = (id: string, patch: Partial<StagingTeamSlot>) =>
    setDraft((d) => ({ ...d, slots: d.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const setStep = (slotId: string, patch: Partial<StagingTeamStep>) =>
    setDraft((d) => ({
      ...d,
      templates: d.templates.map((t, i) =>
        i === 0 ? { ...t, steps: t.steps.map((s) => (s.slotId === slotId ? { ...s, ...patch } : s)) } : t
      ),
    }));
  const addSlot = () => {
    const slot: StagingTeamSlot = { id: freshId("slot"), identityId: "id-writer", label: "Writer", seats: 1 };
    setDraft((d) => ({
      ...d,
      slots: [...d.slots, slot],
      templates: d.templates.map((t, i) =>
        i === 0 ? { ...t, steps: [...t.steps, { slotId: slot.id, title: "", instructions: "" }] } : t
      ),
    }));
  };
  const removeSlot = (id: string) =>
    setDraft((d) => ({
      ...d,
      slots: d.slots.filter((s) => s.id !== id),
      templates: d.templates.map((t) => ({ ...t, steps: t.steps.filter((s) => s.slotId !== id) })),
    }));

  const ready = draft.name.trim() !== "" && draft.slots.length > 0 && seats <= MAX_AGENTS;

  return (
    <FormDialog
      open
      onDiscard={onClose}
      title={team ? "Edit agent team" : "New agent team"}
      primary={{
        label: team ? "Save" : "Create",
        disabled: !ready,
        hint: seats > MAX_AGENTS ? `A team runs at most ${MAX_AGENTS} agents.` : undefined,
        onClick: () => onSave(draft),
      }}
    >
      <UnderlineField
        id="team-name"
        label="Name"
        ariaLabel="Agent team name"
        placeholder="Code cleanup"
        value={draft.name}
        onChange={(name) => setDraft((d) => ({ ...d, name }))}
        autoFocus
      />
      <UnderlineField
        id="team-description"
        label="Description"
        ariaLabel="Agent team description"
        value={draft.description}
        onChange={(description) => setDraft((d) => ({ ...d, description }))}
        multiline
      />

      <FormSection label="Members" caption={`${seats} of ${MAX_AGENTS} agents`}>
        <ul className="flex flex-col gap-2">
          {draft.slots.map((slot) => (
            <li key={slot.id} className="flex min-w-0 items-center gap-2.5">
              <SlotFace identityId={slot.identityId} size={26} />
              <SelectMenu
                value={slot.identityId}
                options={IDENTITY_OPTIONS}
                onChange={(identityId) => setSlot(slot.id, { identityId })}
                ariaLabel="Identity"
                variant="bare"
              />
              <InlineUnderlineField
                label="Role label"
                value={slot.label}
                onChange={(label) => setSlot(slot.id, { label })}
                className="min-w-0 flex-1"
              />
              <SegmentedControl
                options={SEAT_OPTIONS}
                value={String(slot.seats) as "1" | "2" | "3"}
                onChange={(n) => setSlot(slot.id, { seats: Number(n) })}
                variant="plain"
                size="md"
                ariaLabel="Seats"
              />
              <button
                type="button"
                onClick={() => removeSlot(slot.id)}
                aria-label={`Remove ${slot.label}`}
                className="flex size-6 flex-none cursor-pointer items-center justify-center rounded-md text-text-muted hover:text-text-primary"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addSlot}
          className="flex cursor-pointer items-center gap-1.5 self-start text-caption font-medium text-text-secondary hover:text-text-primary"
        >
          <Plus size={13} aria-hidden="true" />
          Add member
        </button>
      </FormSection>

      {template && (
        <FormSection label="Task template" caption="one step per member">
          <InlineUnderlineField
            label="Template title"
            value={template.title}
            onChange={(title) =>
              setDraft((d) => ({
                ...d,
                templates: d.templates.map((t, i) => (i === 0 ? { ...t, title } : t)),
              }))
            }
          />
          <ol className="flex flex-col gap-3 pt-1">
            {template.steps.map((step) => {
              const slot = draft.slots.find((s) => s.id === step.slotId);
              return (
                <li key={step.slotId} className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-caption text-text-muted">
                    {slot && <SlotFace identityId={slot.identityId} size={18} />}
                    {slot?.label}
                  </span>
                  <InlineUnderlineField
                    label="Step title"
                    value={step.title}
                    onChange={(title) => setStep(step.slotId, { title })}
                  />
                  <InlineUnderlineField
                    label="Instructions for this role"
                    value={step.instructions}
                    onChange={(instructions) => setStep(step.slotId, { instructions })}
                    multiline
                  />
                </li>
              );
            })}
          </ol>
        </FormSection>
      )}
    </FormDialog>
  );
}

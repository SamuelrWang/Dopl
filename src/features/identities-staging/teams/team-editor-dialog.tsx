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
import type { StagingAgentTeam, StagingTeamSlot } from "../data/agent-teams";
import { SlotFace } from "./team-faces";

const SEAT_OPTIONS = [
  { key: "1", label: "×1" },
  { key: "2", label: "×2" },
  { key: "3", label: "×3" },
] as const;

const IDENTITY_OPTIONS = SEED_IDENTITIES.map((i) => ({ value: i.id, label: i.name }));

/** The cap a run holds to (PROPOSAL §6 defaults): five agents, three seats per slot. */
const MAX_AGENTS = 5;

const NO_LEAD = "none";

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
    leadIdentityId: null,
  };
}

/**
 * STAGED EDITOR: the popup form kit over local state. Name, members (identity, label, seats) and
 * an optional lead from the roster. A team holds no saved tasks. Save hands the team back.
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
  const seats = draft.slots.reduce((n, s) => n + s.seats, 0);

  const setSlot = (id: string, patch: Partial<StagingTeamSlot>) =>
    setDraft((d) => ({ ...d, slots: d.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const addSlot = () => {
    const slot: StagingTeamSlot = { id: freshId("slot"), identityId: "id-writer", label: "Writer", seats: 1 };
    setDraft((d) => ({ ...d, slots: [...d.slots, slot] }));
  };
  const removeSlot = (id: string) =>
    setDraft((d) => {
      const slots = d.slots.filter((s) => s.id !== id);
      // A lead who left the roster is no lead.
      const lead = slots.some((s) => s.identityId === d.leadIdentityId) ? d.leadIdentityId : null;
      return { ...d, slots, leadIdentityId: lead };
    });

  const leadOptions = [
    { value: NO_LEAD, label: "No lead", description: "The members decide among themselves" },
    ...[...new Set(draft.slots.map((sl) => sl.identityId))].map((id) => ({
      value: id,
      label: IDENTITY_OPTIONS.find((o) => o.value === id)?.label ?? "Deleted identity",
      description: "Splits and manages the work",
    })),
  ];

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
              <SlotFace identityId={slot.identityId} size="m" />
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

      <FormSection label="Lead" caption="optional">
        <span className="flex min-w-0 items-center gap-2.5">
          {draft.leadIdentityId && <SlotFace identityId={draft.leadIdentityId} size="m" />}
          <SelectMenu
            value={draft.leadIdentityId ?? NO_LEAD}
            options={leadOptions}
            onChange={(v) => setDraft((d) => ({ ...d, leadIdentityId: v === NO_LEAD ? null : v }))}
            ariaLabel="Lead"
            variant="bare"
          />
        </span>
      </FormSection>
    </FormDialog>
  );
}

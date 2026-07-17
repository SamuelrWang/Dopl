"use client";

import { useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { SectionBox } from "@/shared/ui/section-box";
import { FIELD_WELL } from "@/shared/ui/wells";
import type { ArtifactKind, TaskStep } from "../types";
import {
  AddRowButton,
  ARTIFACT_META,
  DeleteStepButton,
  DetailHeader,
  DetailShell,
  FieldLabel,
  IdentityBlock,
  KindTile,
  MonoWell,
  RaisedTextarea,
} from "./config-fields";

/**
 * Editor for an agent task step — the artifact each member's agent
 * creates, the prompt that drives it, the template structure the result
 * should follow, and its done-when criteria.
 */
export function TaskEditor({
  step,
  stepNumber,
  onPatch,
  onDelete,
}: {
  step: TaskStep;
  stepNumber: number;
  onPatch: (patch: Partial<TaskStep>) => void;
  onDelete: () => void;
}) {
  return (
    <DetailShell
      header={
        <DetailHeader
          kind="Agent task"
          meta={`Step ${stepNumber} · each member runs this once`}
          actions={<DeleteStepButton name={step.title} onDelete={onDelete} />}
        />
      }
    >
      <IdentityBlock
        tile={<KindTile icon={ARTIFACT_META[step.artifact].icon} size="md" />}
        name={step.title}
        onName={(title) => onPatch({ title })}
        namePlaceholder="What the agent creates"
        summary={step.summary}
        onSummary={(summary) => onPatch({ summary })}
        summaryPlaceholder="One-liner members see under the title…"
      />

      <div className="flex items-center gap-4 px-1">
        <label className="flex items-center gap-2">
          <FieldLabel>Artifact</FieldLabel>
          <select
            value={step.artifact}
            onChange={(e) => onPatch({ artifact: e.target.value as ArtifactKind })}
            aria-label="Artifact kind"
            className={cn(FIELD_WELL, "h-7 px-1.5 text-small text-text-secondary")}
          >
            {Object.entries(ARTIFACT_META).map(([kind, meta]) => (
              <option key={kind} value={kind}>
                {meta.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <FieldLabel>Time</FieldLabel>
          <input
            type="text"
            inputMode="numeric"
            value={step.estMinutes}
            onChange={(e) => onPatch({ estMinutes: Number(e.target.value) || 0 })}
            aria-label="Estimated minutes"
            className={cn(FIELD_WELL, "h-7 w-14 px-2 text-center text-body text-text-primary")}
          />
          <span className="text-caption text-text-muted">min, roughly</span>
        </label>
      </div>

      <SectionBox label="Task brief" meta="what members read before running it">
        <div className="p-3">
          <RaisedTextarea
            value={step.detail}
            onChange={(detail) => onPatch({ detail })}
            rows={3}
            placeholder="What this creates and why the team wants it…"
            ariaLabel={`${step.title} brief`}
          />
        </div>
      </SectionBox>

      <SectionBox label="Prompt for the agent" meta="members paste this verbatim">
        <div className="p-3">
          <MonoWell
            value={step.agentPrompt}
            onChange={(agentPrompt) => onPatch({ agentPrompt })}
            rows={5}
            placeholder="Write it like you'd brief a new hire's assistant…"
            ariaLabel={`${step.title} agent prompt`}
            trailing={
              step.agentPrompt ? (
                <CopyButton
                  text={step.agentPrompt}
                  size={13}
                  label={`Copy ${step.title} prompt`}
                />
              ) : undefined
            }
          />
        </div>
      </SectionBox>

      <StructureEditor step={step} onPatch={onPatch} />
      <DoneWhenEditor step={step} onPatch={onPatch} />
    </DetailShell>
  );
}

/** Template fields the artifact should include — ontology-attribute rows. */
function StructureEditor({
  step,
  onPatch,
}: {
  step: TaskStep;
  onPatch: (patch: Partial<TaskStep>) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newHint, setNewHint] = useState("");
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    onPatch({ structure: [...step.structure, { name, hint: newHint.trim() }] });
    setNewName("");
    setNewHint("");
  };
  const patchField = (i: number, patch: Partial<TaskStep["structure"][number]>) =>
    onPatch({
      structure: step.structure.map((f, j) => (j === i ? { ...f, ...patch } : f)),
    });

  return (
    <SectionBox
      label="Structure"
      meta={`${step.structure.length} fields the ${ARTIFACT_META[step.artifact].label.toLowerCase()} should include`}
    >
      {step.structure.length > 0 && (
        <div className="flex flex-col gap-2 px-3 py-3">
          {step.structure.map((field, i) => (
            <div
              key={i}
              className="bento group flex items-center gap-3 px-3.5 py-1.5"
            >
              <input
                type="text"
                value={field.name}
                onChange={(e) => patchField(i, { name: e.target.value })}
                aria-label="Field name"
                placeholder="field…"
                className="w-36 shrink-0 bg-transparent text-lead text-text-secondary placeholder:text-text-muted focus:text-text-primary focus:outline-none"
              />
              <input
                type="text"
                value={field.hint}
                onChange={(e) => patchField(i, { hint: e.target.value })}
                aria-label={`${field.name} hint`}
                placeholder="what goes here…"
                className="min-w-0 flex-1 bg-transparent text-lead text-text-primary placeholder:text-text-muted focus:outline-none"
              />
              <button
                type="button"
                aria-label={`Remove ${field.name}`}
                onClick={() =>
                  onPatch({ structure: step.structure.filter((_, j) => j !== i) })
                }
                className="rounded-md p-1 text-text-muted opacity-0 transition hover:bg-surface-raised-3 hover:text-text-primary group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 border-t border-border-subtle bg-card-surface-subtle px-4 py-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="new field…"
          aria-label="New structure field"
          className={cn(FIELD_WELL, "h-7 w-36 px-2.5 text-body text-text-primary placeholder:text-text-muted")}
        />
        <input
          type="text"
          value={newHint}
          onChange={(e) => setNewHint(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="hint…"
          aria-label="New field hint"
          className={cn(FIELD_WELL, "h-7 min-w-0 flex-1 px-2.5 text-body text-text-primary placeholder:text-text-muted")}
        />
        <AddRowButton onClick={add} />
      </div>
    </SectionBox>
  );
}

/** Acceptance criteria rows. */
function DoneWhenEditor({
  step,
  onPatch,
}: {
  step: TaskStep;
  onPatch: (patch: Partial<TaskStep>) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onPatch({ doneWhen: [...step.doneWhen, text] });
    setDraft("");
  };

  return (
    <SectionBox label="Done when" meta="how the agent knows it's finished">
      {step.doneWhen.length > 0 && (
        <div className="divide-y divide-border-subtle">
          {step.doneWhen.map((item, i) => (
            <div key={i} className="group flex items-center gap-2.5 px-3.5 py-2">
              <CheckCircle2 size={13} className="shrink-0 text-text-muted" />
              <input
                type="text"
                value={item}
                onChange={(e) =>
                  onPatch({
                    doneWhen: step.doneWhen.map((d, j) =>
                      j === i ? e.target.value : d
                    ),
                  })
                }
                aria-label={`Criterion ${i + 1}`}
                className="min-w-0 flex-1 bg-transparent text-body text-text-primary focus:outline-none"
              />
              <button
                type="button"
                aria-label={`Remove criterion ${i + 1}`}
                onClick={() =>
                  onPatch({ doneWhen: step.doneWhen.filter((_, j) => j !== i) })
                }
                className="rounded-md p-1 text-text-muted opacity-0 transition hover:bg-surface-raised-3 hover:text-text-primary group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 border-t border-border-subtle bg-card-surface-subtle px-4 py-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="new criterion…"
          aria-label="New done-when criterion"
          className={cn(FIELD_WELL, "h-7 min-w-0 flex-1 px-2.5 text-body text-text-primary placeholder:text-text-muted")}
        />
        <AddRowButton onClick={add} />
      </div>
    </SectionBox>
  );
}

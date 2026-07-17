"use client";

import { useState } from "react";
import { BookText, FileText, Plus, Trash2, X, Zap } from "lucide-react";
import { SectionBox } from "@/shared/ui/section-box";
import { cn } from "@/shared/lib/utils";
import type { WorkflowGraph } from "../client/types";
import type { WorkflowStep, WorkflowStepAction, WorkflowStepRead } from "../types";
import { useWorkflowResources } from "../hooks/use-workflow-resources";
import type { WorkflowOps } from "../hooks/use-workflows";
import { PickMenu } from "./pick-menu";
import { ReadPickMenu } from "./read-pick-menu";
import { StepConnections } from "./step-connections";
import { FIELD_WELL } from "./workflow-bits";

interface Props {
  workflowId: string;
  step: WorkflowStep;
  graph: WorkflowGraph;
  canEdit: boolean;
  ops: WorkflowOps;
  onClose: () => void;
  onSelectStep: (id: string) => void;
}

const readToInput = (r: WorkflowStepRead) =>
  r.entryId ? { kbId: r.kbId, entryId: r.entryId } : { kbId: r.kbId };

/**
 * Right-side editor for the selected step: identity (title/description),
 * then Context (knowledge reads), Skills (actions), Fields (user input /
 * agent output / next instructions), and Connections. Text edits persist
 * debounced + optimistic; structural edits (reads/actions/edges) apply then
 * re-fetch the composed graph. Read-only for viewers.
 */
export function StepPanel({
  workflowId,
  step,
  graph,
  canEdit,
  ops,
  onClose,
  onSelectStep,
}: Props) {
  const { workspaceId, bases, skills } = useWorkflowResources();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setText = (patch: Partial<WorkflowStep>) =>
    ops.patchStep(workflowId, step.id, patch, patch, { debounce: true });

  const setReads = (reads: WorkflowStepRead[]) =>
    ops.patchStep(workflowId, step.id, { reads: reads.map(readToInput) }, { reads });

  const setActions = (actions: WorkflowStepAction[]) =>
    ops.patchStep(
      workflowId,
      step.id,
      { actions: actions.map((a) => ({ skillId: a.skillId })) },
      { actions }
    );

  const skillItems = skills.map((s) => ({ id: s.id, name: s.name, group: s.scope }));

  return (
    <div className="my-2 mr-2 flex min-h-0 w-[420px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-border-highlight bg-bg-elevated shadow-[0_2px_6px_rgba(0,0,0,0.07),0_16px_40px_-10px_rgba(0,0,0,0.22)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-card-surface-subtle px-3 py-2">
        <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-2.5 py-0.5 text-caption font-semibold text-text-secondary">
          Step
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-micro text-text-muted">
          {step.ref}
        </span>
        {canEdit &&
          (confirmDelete ? (
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  ops.removeStep(workflowId, step.id);
                  onClose();
                }}
                className="rounded-md bg-danger/10 px-2 py-1 text-caption font-semibold text-danger"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="btn-light rounded-md px-2 py-1 text-caption font-medium text-text-primary"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              aria-label="Delete step"
              title="Delete step"
              onClick={() => setConfirmDelete(true)}
              className="btn-light flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-text-primary"
            >
              <Trash2 size={11} />
            </button>
          ))}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="btn-light flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-text-primary"
        >
          <X size={12} />
        </button>
      </div>

      <div className="min-h-0 grow overflow-y-auto overscroll-contain p-3">
        <div className="flex flex-col gap-3">
          <div>
            <input
              type="text"
              value={step.title}
              readOnly={!canEdit}
              onChange={(e) => setText({ title: e.target.value })}
              className="w-full bg-transparent text-display font-semibold leading-snug tracking-tight text-text-primary placeholder:text-text-muted focus:outline-none"
              placeholder="Step title"
              aria-label="Step title"
            />
            <input
              type="text"
              value={step.description}
              readOnly={!canEdit}
              onChange={(e) => setText({ description: e.target.value })}
              placeholder="What happens in this step (agents read this)…"
              className="mt-0.5 w-full bg-transparent text-lead text-text-secondary placeholder:text-text-muted focus:outline-none"
              aria-label="Step description"
            />
          </div>

          <SectionBox
            label="Knowledge"
            meta={`${step.reads.length}`}
            action={
              canEdit ? (
                <ReadPickMenu
                  workspaceId={workspaceId}
                  bases={bases}
                  excludeBaseIds={step.reads.filter((r) => !r.entryId).map((r) => r.kbId)}
                  excludeEntryIds={step.reads
                    .map((r) => r.entryId)
                    .filter((id): id is string => Boolean(id))}
                  onPick={(ref, name) =>
                    setReads([
                      ...step.reads,
                      { kind: ref.entryId ? "file" : "kb", kbId: ref.kbId, entryId: ref.entryId, name },
                    ])
                  }
                  trigger={
                    <span className="flex items-center gap-1">
                      <Plus size={11} /> Add
                    </span>
                  }
                  triggerClassName="btn-light flex h-6 items-center gap-1 rounded-md px-2 text-caption font-medium text-text-primary"
                />
              ) : undefined
            }
          >
            <RefList
              empty="No knowledge attached. Add the KBs or files this step should consult."
              items={step.reads.map((r, i) => ({
                key: `${r.kbId}-${r.entryId ?? ""}-${i}`,
                icon: r.kind === "file" ? <FileText size={12} /> : <BookText size={12} />,
                name: r.name || (r.kind === "file" ? "File" : "Knowledge base"),
                onRemove: canEdit ? () => setReads(step.reads.filter((_, j) => j !== i)) : undefined,
              }))}
            />
          </SectionBox>

          <SectionBox
            label="Skills"
            meta={`${step.actions.length}`}
            action={
              canEdit ? (
                <PickMenu
                  items={skillItems}
                  excludeIds={step.actions.map((a) => a.skillId)}
                  onPick={(skillId) => {
                    const name = skills.find((s) => s.id === skillId)?.name ?? "Skill";
                    setActions([...step.actions, { kind: "skill", skillId, name }]);
                  }}
                  trigger={
                    <span className="flex items-center gap-1">
                      <Plus size={11} /> Add
                    </span>
                  }
                  triggerClassName="btn-light flex h-6 items-center gap-1 rounded-md px-2 text-caption font-medium text-text-primary"
                />
              ) : undefined
            }
          >
            <RefList
              empty="No skills yet. Add the actions an agent runs at this step."
              items={step.actions.map((a, i) => ({
                key: `${a.skillId}-${i}`,
                icon: <Zap size={12} />,
                name: a.name || "Skill",
                onRemove: canEdit
                  ? () => setActions(step.actions.filter((_, j) => j !== i))
                  : undefined,
              }))}
            />
          </SectionBox>

          <SectionBox label="Fields">
            <div className="flex flex-col gap-2 px-3 py-3">
              <FieldWell
                label="User input"
                value={step.userInput}
                canEdit={canEdit}
                placeholder="What the step needs from the user (if anything)…"
                onChange={(v) => setText({ userInput: v })}
              />
              <FieldWell
                label="Agent output"
                value={step.agentOutput}
                canEdit={canEdit}
                placeholder="What the agent produces here…"
                onChange={(v) => setText({ agentOutput: v })}
              />
              <FieldWell
                label="Next instructions"
                value={step.nextInstructions}
                canEdit={canEdit}
                placeholder="How the agent decides what to do next…"
                onChange={(v) => setText({ nextInstructions: v })}
              />
            </div>
          </SectionBox>

          <StepConnections
            workflowId={workflowId}
            stepId={step.id}
            graph={graph}
            canEdit={canEdit}
            onConnect={(wf, from, to, condition) => ops.connectSteps(wf, from, to, condition)}
            onEditCondition={(wf, from, to, condition) =>
              ops.connectSteps(wf, from, to, condition, { debounce: true })
            }
            onDisconnect={ops.disconnectSteps}
            onAddNext={async () => {
              const id = await ops.addStep(workflowId, step.id);
              if (id) onSelectStep(id);
            }}
            onSelectStep={onSelectStep}
          />
        </div>
      </div>
    </div>
  );
}

interface RefItem {
  key: string;
  icon: React.ReactNode;
  name: string;
  onRemove?: () => void;
}

function RefList({ items, empty }: { items: RefItem[]; empty: string }) {
  if (items.length === 0) {
    return <p className="px-3 py-3 text-caption text-text-muted">{empty}</p>;
  }
  return (
    <div className="flex flex-col gap-1.5 px-3 py-3">
      {items.map((item) => (
        <div
          key={item.key}
          className="bento group flex items-center gap-2 px-3 py-1.5"
        >
          <span className="shrink-0 text-text-muted">{item.icon}</span>
          <span className="min-w-0 flex-1 truncate text-body text-text-primary">{item.name}</span>
          {item.onRemove && (
            <button
              type="button"
              aria-label={`Remove ${item.name}`}
              onClick={item.onRemove}
              className="rounded-md p-1 text-text-muted opacity-0 transition hover:bg-surface-raised-3 hover:text-text-primary group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function FieldWell({
  label,
  value,
  canEdit,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  canEdit: boolean;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="px-0.5 text-label font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <textarea
        value={value}
        readOnly={!canEdit}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className={cn(
          FIELD_WELL,
          "w-full resize-y px-2.5 py-2 text-body leading-relaxed text-text-primary placeholder:text-text-muted"
        )}
      />
    </label>
  );
}

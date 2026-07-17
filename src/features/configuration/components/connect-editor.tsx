"use client";

import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { SectionBox } from "@/shared/ui/section-box";
import { Switch } from "@/shared/ui/switch";
import { FIELD_WELL } from "@/shared/ui/wells";
import type { ConnectStep } from "../types";
import { BrandTile } from "./brand-tile";
import {
  ChipEditor,
  DeleteStepButton,
  DetailHeader,
  DetailShell,
  FieldLabel,
  IdentityBlock,
  MonoWell,
  RaisedInput,
  RaisedTextarea,
} from "./config-fields";

/**
 * Editor for a connect step — the tool identity, how the team uses it,
 * what the member does to hook it up, and the context blurb their agent
 * is served once connected.
 */
export function ConnectEditor({
  step,
  stepNumber,
  onPatch,
  onDelete,
}: {
  step: ConnectStep;
  stepNumber: number;
  onPatch: (patch: Partial<ConnectStep>) => void;
  onDelete: () => void;
}) {
  return (
    <DetailShell
      header={
        <DetailHeader
          kind="Connection"
          meta={`Step ${stepNumber} · shown to every member`}
          actions={<DeleteStepButton name={step.name} onDelete={onDelete} />}
        />
      }
    >
      <IdentityBlock
        tile={<BrandTile name={step.name} />}
        name={step.name}
        onName={(name) => onPatch({ name })}
        namePlaceholder="Tool name"
        summary={step.summary}
        onSummary={(summary) => onPatch({ summary })}
        summaryPlaceholder="One-liner members see under the name…"
      />

      <div className="flex items-center gap-4 px-1">
        <label className="flex items-center gap-2">
          <FieldLabel>Category</FieldLabel>
          <input
            type="text"
            value={step.category}
            onChange={(e) => onPatch({ category: e.target.value })}
            placeholder="CRM, Docs…"
            aria-label="Category"
            className={cn(FIELD_WELL, "h-7 w-36 px-2.5 text-body text-text-primary placeholder:text-text-muted")}
          />
        </label>
        <label className="flex items-center gap-2">
          <FieldLabel>Required</FieldLabel>
          <Switch
            checked={step.required}
            onChange={(required) => onPatch({ required })}
            aria-label={`${step.name} required`}
          />
        </label>
        <span className="text-caption text-text-muted">
          {step.required
            ? "Members can't finish setup without it."
            : "Members may skip this one."}
        </span>
      </div>

      <SectionBox label="How the team uses it">
        <div className="flex flex-col gap-2.5 p-3">
          <RaisedTextarea
            value={step.whyText}
            onChange={(whyText) => onPatch({ whyText })}
            rows={3}
            placeholder="Why this tool is part of the team's setup…"
            ariaLabel={`How the team uses ${step.name}`}
          />
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Permissions</FieldLabel>
            <ChipEditor
              items={step.scopes}
              onChange={(scopes) => onPatch({ scopes })}
              addPlaceholder="add permission…"
              ariaLabel={`Add ${step.name} permission`}
            />
          </div>
        </div>
      </SectionBox>

      <SectionBox label="Member setup" meta="what teammates see and run">
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Where to go</FieldLabel>
            <div className="flex gap-2">
              <RaisedInput
                value={step.linkLabel}
                onChange={(linkLabel) => onPatch({ linkLabel })}
                placeholder="Link label"
                ariaLabel={`${step.name} link label`}
                className="w-44 shrink-0"
              />
              <RaisedInput
                value={step.linkHref}
                onChange={(linkHref) => onPatch({ linkHref })}
                placeholder="https://…"
                ariaLabel={`${step.name} link URL`}
                className="min-w-0 flex-1"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Setup command</FieldLabel>
            <MonoWell
              value={step.setupCommand}
              onChange={(setupCommand) => onPatch({ setupCommand })}
              rows={1}
              placeholder="Terminal command, if one exists…"
              ariaLabel={`${step.name} setup command`}
              trailing={
                step.setupCommand ? (
                  <CopyButton
                    text={step.setupCommand}
                    size={13}
                    label={`Copy ${step.name} setup command`}
                  />
                ) : undefined
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Notes for the member</FieldLabel>
            <RaisedTextarea
              value={step.memberNote}
              onChange={(memberNote) => onPatch({ memberNote })}
              rows={2}
              placeholder="OAuth flow, where credentials come from, who to ask…"
              ariaLabel={`${step.name} setup notes`}
            />
          </div>
        </div>
      </SectionBox>

      <SectionBox label="Agent context" meta="served over MCP once connected">
        <div className="flex flex-col gap-2 p-3">
          <MonoWell
            value={step.agentContext}
            onChange={(agentContext) => onPatch({ agentContext })}
            rows={4}
            placeholder="How this tool fits the agent's workflows — dos and don'ts…"
            ariaLabel={`${step.name} agent context`}
            trailing={
              step.agentContext ? (
                <CopyButton
                  text={step.agentContext}
                  size={13}
                  label={`Copy ${step.name} agent context`}
                />
              ) : undefined
            }
          />
          <p className="text-caption leading-relaxed text-text-muted">
            Members never paste this — Dopl serves it to their agent
            automatically, and published edits apply on the next run.
          </p>
        </div>
      </SectionBox>
    </DetailShell>
  );
}

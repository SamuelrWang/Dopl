"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { FileText, Plus, Plug, Send, ShieldCheck, WandSparkles } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import type { AgentGuide, GuideSelection, SetupStep } from "../types";
import { BrandTile } from "./brand-tile";
import { ARTIFACT_META, KindTile } from "./config-fields";

/**
 * Build-mode list pane — the guide's outline. Profile blocks on top,
 * then the ordered setup steps, then rollout. Selection drives the
 * detail pane; the + menu adds typed steps.
 */
export function GuideOutline({
  guide,
  selection,
  onSelect,
  onAddStep,
  onAddGuardrail,
}: {
  guide: AgentGuide;
  selection: GuideSelection;
  onSelect: (next: GuideSelection) => void;
  onAddStep: (kind: SetupStep["kind"]) => void;
  onAddGuardrail: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const setUp = guide.members.filter((m) => m.status === "complete").length;

  return (
    <div className="flex w-[320px] shrink-0 flex-col border-r border-border-default">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <OutlineGroup label="Profile">
          <OutlineRow
            selected={selection.type === "mission"}
            onClick={() => onSelect({ type: "mission" })}
            tile={<KindTile icon={FileText} />}
            title="Agent instructions"
            caption="Prepended to every session"
          />
          <OutlineRow
            selected={selection.type === "guardrails"}
            onClick={() => onSelect({ type: "guardrails" })}
            tile={<KindTile icon={ShieldCheck} />}
            title="Guardrails"
            caption={`${guide.guardrails.length} standing rules`}
          />
        </OutlineGroup>

        <OutlineGroup
          label="Setup steps"
          meta={`${guide.steps.length}`}
          action={
            <span className="relative">
              <button
                type="button"
                aria-label="Add step"
                onClick={() => setAddOpen(true)}
                className="flex h-6 w-6 items-center justify-center rounded-[6px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
              >
                <Plus size={13} />
              </button>
              <Popover open={addOpen} onClose={() => setAddOpen(false)} align="right">
                <MenuItem
                  icon={<Plug size={13} />}
                  description="MCP server or app your agents need"
                  onSelect={() => {
                    setAddOpen(false);
                    onAddStep("connect");
                  }}
                >
                  Connect a tool
                </MenuItem>
                <MenuItem
                  icon={<WandSparkles size={13} />}
                  description="Something each member's agent creates"
                  onSelect={() => {
                    setAddOpen(false);
                    onAddStep("task");
                  }}
                >
                  Agent task
                </MenuItem>
                <MenuItem
                  icon={<ShieldCheck size={13} />}
                  description="Standing rule for every session"
                  onSelect={() => {
                    setAddOpen(false);
                    onAddGuardrail();
                  }}
                >
                  Guardrail
                </MenuItem>
              </Popover>
            </span>
          }
        >
          {guide.steps.map((step, i) => (
            <StepRow
              key={step.id}
              step={step}
              index={i}
              selected={selection.type === "step" && selection.id === step.id}
              onClick={() => onSelect({ type: "step", id: step.id })}
            />
          ))}
        </OutlineGroup>

        <OutlineGroup label="Rollout">
          <OutlineRow
            selected={selection.type === "rollout"}
            onClick={() => onSelect({ type: "rollout" })}
            tile={<KindTile icon={Send} />}
            title="Publish & adoption"
            caption={`${setUp} of ${guide.members.length} members set up · v${guide.version}`}
          />
        </OutlineGroup>
      </div>
    </div>
  );
}

function StepRow({
  step,
  index,
  selected,
  onClick,
}: {
  step: SetupStep;
  index: number;
  selected: boolean;
  onClick: () => void;
}) {
  const caption =
    step.kind === "connect"
      ? `Step ${index + 1} · ${step.category || "Connection"} · ${step.required ? "Required" : "Optional"}`
      : `Step ${index + 1} · Agent task · ~${step.estMinutes} min`;
  return (
    <OutlineRow
      selected={selected}
      onClick={onClick}
      tile={
        step.kind === "connect" ? (
          <BrandTile name={step.name} size="sm" />
        ) : (
          <KindTile icon={ARTIFACT_META[step.artifact].icon} />
        )
      }
      title={step.kind === "connect" ? `Connect ${step.name}` : step.title}
      caption={caption}
    />
  );
}

function OutlineGroup({
  label,
  meta,
  action,
  children,
}: {
  label: string;
  meta?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 px-3.5 pb-1.5 pt-4">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          {label}
        </span>
        {meta && <span className="text-micro text-text-muted">{meta}</span>}
        <span className="flex-1" />
        {action}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function OutlineRow({
  selected,
  onClick,
  tile,
  title,
  caption,
}: {
  selected: boolean;
  onClick: () => void;
  tile: ReactNode;
  title: string;
  caption: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mx-2 flex items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left transition-colors",
        selected ? "concave-sel" : "hover:bg-surface-raised-1"
      )}
    >
      {tile}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-text-primary">
          {title}
        </span>
        <span className="block truncate text-caption text-text-muted">{caption}</span>
      </span>
    </button>
  );
}

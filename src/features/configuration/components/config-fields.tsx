"use client";

import { useState } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import type { ReactNode } from "react";
import { BookOpen, FileText, Plus, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CHIP, FIELD_WELL, RAISED_WELL } from "@/shared/ui/wells";
import type { AdoptionStatus, ArtifactKind, GuardrailPolicy } from "../types";

/**
 * Shared presentational atoms for the configuration page — the ontology
 * object-panel language: kind-pill header strips, raised wells on inset
 * bodies, chip rows.
 */

export const ARTIFACT_META: Record<
  ArtifactKind,
  { label: string; icon: LucideIcon }
> = {
  file: { label: "File", icon: FileText },
  "knowledge-base": { label: "Knowledge base", icon: BookOpen },
  skill: { label: "Skill", icon: Sparkles },
};

export const POLICY_META: Record<
  GuardrailPolicy,
  { label: string; cls: string }
> = {
  always: { label: "Always OK", cls: "bg-success/10 text-success" },
  ask: { label: "Ask first", cls: "bg-warning/10 text-warning" },
  never: { label: "Never", cls: "bg-danger/10 text-danger" },
};

export const ADOPTION_META: Record<
  AdoptionStatus,
  { label: string; cls: string }
> = {
  complete: { label: "Set up", cls: "bg-success/10 text-success" },
  drifted: { label: "Out of date", cls: "bg-warning/10 text-warning" },
  "not-started": { label: "Not started", cls: "bg-danger/10 text-danger" },
};

const PILL = "rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wide";

export function PolicyPill({ policy }: { policy: GuardrailPolicy }) {
  const meta = POLICY_META[policy];
  return (
    <span className={cn(PILL, "w-[72px] shrink-0 text-center", meta.cls)}>
      {meta.label}
    </span>
  );
}

export function AdoptionPill({ status }: { status: AdoptionStatus }) {
  const meta = ADOPTION_META[status];
  return <span className={cn(PILL, "shrink-0", meta.cls)}>{meta.label}</span>;
}

/** Detail-pane scaffold: header strip + centered scrolling body. */
export function DetailShell({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {header}
      <div className="min-h-0 grow overflow-y-auto overscroll-contain p-4">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Ontology-style header strip: kind pill · meta · actions. */
export function DetailHeader({
  kind,
  meta,
  actions,
}: {
  kind: string;
  meta?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-card-surface-subtle px-3 py-2">
      <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-2.5 py-0.5 text-caption font-semibold text-text-secondary">
        {kind}
      </span>
      {meta && (
        <span className="min-w-0 flex-1 truncate text-caption text-text-muted">
          {meta}
        </span>
      )}
      {!meta && <span className="flex-1" />}
      {actions}
    </div>
  );
}

/** Two-step delete (ontology object-panel pattern) for guide steps. */
export function DeleteStepButton({
  name,
  onDelete,
}: {
  name: string;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md bg-danger/10 px-2 py-1 text-caption font-semibold text-danger"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="btn-light rounded-md px-2 py-1 text-caption font-medium text-text-primary"
        >
          Keep
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Delete ${name}`}
      title="Delete step"
      onClick={() => setConfirming(true)}
      className="btn-light flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-text-primary"
    >
      <Trash2 size={11} />
    </button>
  );
}

/** Editable name + one-liner block at the top of every editor. */
export function IdentityBlock({
  tile,
  name,
  onName,
  namePlaceholder,
  summary,
  onSummary,
  summaryPlaceholder,
}: {
  tile?: ReactNode;
  name: string;
  onName?: (next: string) => void;
  namePlaceholder?: string;
  summary: string;
  onSummary?: (next: string) => void;
  summaryPlaceholder?: string;
}) {
  return (
    <div className="flex items-start gap-3 px-1">
      {tile}
      <div className="min-w-0 flex-1">
        <input
          type="text"
          value={name}
          readOnly={!onName}
          onChange={(e) => onName?.(e.target.value)}
          placeholder={namePlaceholder}
          aria-label="Step name"
          className="w-full bg-transparent text-display font-semibold leading-snug tracking-tight text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <input
          type="text"
          value={summary}
          readOnly={!onSummary}
          onChange={(e) => onSummary?.(e.target.value)}
          placeholder={summaryPlaceholder}
          aria-label="Step summary"
          className="mt-0.5 w-full bg-transparent text-lead text-text-secondary placeholder:text-text-muted focus:outline-none"
        />
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
      {children}
    </span>
  );
}

/** Raised single-line input on an inset body. */
export function RaisedInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(
        RAISED_WELL,
        "px-2.5 py-1.5 text-body text-text-primary placeholder:text-text-muted focus:outline-none",
        className
      )}
    />
  );
}

/** Raised multi-line prose field on an inset body. */
export function RaisedTextarea({
  value,
  onChange,
  rows = 3,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  ariaLabel: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(
        RAISED_WELL,
        "w-full resize-none p-2.5 text-body leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none"
      )}
    />
  );
}

/** Raised mono well (agent-facing text) with a copy affordance slot. */
export function MonoWell({
  value,
  onChange,
  rows = 4,
  placeholder,
  ariaLabel,
  trailing,
}: {
  value: string;
  onChange?: (next: string) => void;
  rows?: number;
  placeholder?: string;
  ariaLabel: string;
  trailing?: ReactNode;
}) {
  return (
    <div className={cn(RAISED_WELL, "relative")}>
      <textarea
        value={value}
        readOnly={!onChange}
        onChange={(e) => onChange?.(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="w-full resize-none bg-transparent p-2.5 pr-9 font-mono text-small leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      {trailing && <span className="absolute right-2 top-2">{trailing}</span>}
    </div>
  );
}

/** Chip row with inline add/remove — scopes, tags. */
export function ChipEditor({
  items,
  onChange,
  addPlaceholder,
  ariaLabel,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  addPlaceholder: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className={cn(CHIP, "flex items-center gap-1.5")}>
          {item}
          <button
            type="button"
            aria-label={`Remove ${item}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="text-text-muted hover:text-text-primary"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        onBlur={add}
        placeholder={addPlaceholder}
        aria-label={ariaLabel}
        className={cn(FIELD_WELL, "h-6 w-36 rounded-full px-2.5 text-caption text-text-primary placeholder:text-text-muted")}
      />
    </div>
  );
}

/** The `+ Add` button used by SectionBox footer add-rows. */
export function AddRowButton({
  onClick,
  children = (
    <>
      <Plus size={11} /> Add
    </>
  ),
}: {
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-light flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-small font-medium text-text-primary"
    >
      {children}
    </button>
  );
}

/** Neutral icon tile for non-brand outline rows and identity headers. */
export function KindTile({
  icon: Icon,
  size = "sm",
}: {
  icon: LucideIcon;
  size?: "sm" | "md";
}) {
  const iconProps: LucideProps = size === "sm" ? { size: 13 } : { size: 16 };
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center border border-border-default bg-bg-inset text-text-secondary",
        size === "sm" ? "h-7 w-7 rounded-[8px]" : "h-9 w-9 rounded-[9px]"
      )}
      aria-hidden
    >
      <Icon {...iconProps} />
    </span>
  );
}

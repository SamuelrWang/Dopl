"use client";

import { useState } from "react";
import { Check, CheckCircle2, ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { FIELD_WELL } from "@/shared/ui/wells";
import type { ConnectStep, SetupStep, TaskStep } from "../types";
import { ARTIFACT_META, FieldLabel } from "./config-fields";

/** Flat pill for chips sitting on a card surface (design-doc recipe). */
const FLAT_PILL =
  "rounded-full border border-border-strong bg-bg-inset px-2.5 py-0.5 text-small font-medium text-text-secondary";

/**
 * One step of the member-facing guide — a bento card that expands into
 * the instructions, links, commands, and prompts the member needs.
 * Pending steps start open; finished ones start collapsed.
 */
export function MemberStepCard({
  step,
  stepNumber,
}: {
  step: SetupStep;
  stepNumber: number;
}) {
  const [open, setOpen] = useState(!step.sampleDone);
  const title = step.kind === "connect" ? `Connect ${step.name}` : step.title;
  const caption =
    step.kind === "connect"
      ? `${step.category || "Connection"} · ${step.required ? "Required" : "Optional"}`
      : `Agent task · ${ARTIFACT_META[step.artifact].label} · ~${step.estMinutes} min`;

  return (
    <div className="bento overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised-1"
      >
        <StatusDisc done={step.sampleDone} number={stepNumber} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold text-text-primary">
            {title}
          </span>
          <span className="block truncate text-caption text-text-muted">
            {caption} · {step.summary}
          </span>
        </span>
        <ChevronDown
          size={15}
          className={cn("shrink-0 text-text-muted transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3.5">
          {step.kind === "connect" ? (
            <ConnectBody step={step} />
          ) : (
            <TaskBody step={step} />
          )}
        </div>
      )}
    </div>
  );
}

function StatusDisc({ done, number }: { done: boolean; number: number }) {
  return done ? (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-text-primary text-white">
      <Check size={12} />
    </span>
  ) : (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-bg-inset text-caption font-semibold text-text-secondary">
      {number}
    </span>
  );
}

function ConnectBody({ step }: { step: ConnectStep }) {
  return (
    <>
      <p className="text-body leading-relaxed text-text-secondary">{step.whyText}</p>
      {step.memberNote && (
        <p className="text-body leading-relaxed text-text-primary">{step.memberNote}</p>
      )}
      {step.setupCommand && (
        <div className={cn(FIELD_WELL, "flex items-center gap-2 px-2.5 py-2")}>
          <code className="min-w-0 flex-1 truncate font-mono text-small text-text-primary">
            {step.setupCommand}
          </code>
          <CopyButton
            text={step.setupCommand}
            size={13}
            label={`Copy ${step.name} setup command`}
          />
        </div>
      )}
      {step.scopes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {step.scopes.map((scope) => (
            <span key={scope} className={FLAT_PILL}>
              {scope}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        {step.linkHref && (
          <a
            href={step.linkHref}
            target="_blank"
            rel="noreferrer"
            className="btn-light flex h-7 items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary"
          >
            <ExternalLink size={12} /> {step.linkLabel || "Open setup page"}
          </a>
        )}
        {!step.sampleDone && (
          <button
            type="button"
            className="auth-btn-3d rounded-lg px-3 py-1.5 text-small font-semibold text-white"
          >
            Connect {step.name}
          </button>
        )}
      </div>
    </>
  );
}

function TaskBody({ step }: { step: TaskStep }) {
  return (
    <>
      <p className="text-body leading-relaxed text-text-secondary">{step.detail}</p>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Paste to your agent</FieldLabel>
        <div className={cn(FIELD_WELL, "relative")}>
          <p className="p-2.5 pr-9 font-mono text-small leading-relaxed text-text-primary">
            {step.agentPrompt}
          </p>
          <span className="absolute right-2 top-2">
            <CopyButton
              text={step.agentPrompt}
              size={13}
              label={`Copy ${step.title} prompt`}
            />
          </span>
        </div>
      </div>
      {step.structure.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <FieldLabel>It should include</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {step.structure.map((field) => (
              <span key={field.name} className={FLAT_PILL} title={field.hint}>
                {field.name}
              </span>
            ))}
          </div>
        </div>
      )}
      {step.doneWhen.length > 0 && (
        <div className="flex flex-col gap-1">
          <FieldLabel>Done when</FieldLabel>
          {step.doneWhen.map((item) => (
            <span key={item} className="flex items-center gap-2 text-body text-text-primary">
              <CheckCircle2 size={13} className="shrink-0 text-text-muted" />
              {item}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

"use client";

import { BookText, FileText, LogIn, Zap } from "lucide-react";
import type { NodeLayout } from "@/shared/graph";
import { cn } from "@/shared/lib/utils";
import type { WorkflowStep } from "../types";
import { FLAT_CHIP } from "./workflow-bits";

interface Props {
  step: WorkflowStep;
  position: NodeLayout;
  /** No incoming edge → an entry step (agents can start here). */
  isEntry: boolean;
  /** Number of outgoing edges (shown in the meta row). */
  outCount: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}

const CARD_SHELL =
  "absolute flex flex-col overflow-hidden rounded-xl border bg-bg-elevated text-left transition-shadow";
const CARD_RESTING =
  "border-border-default shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_12px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_6px_rgba(0,0,0,0.08),0_6px_16px_rgba(0,0,0,0.08)]";
const CARD_SELECTED =
  "border-border-highlight shadow-[0_0_0_1px_rgba(0,0,0,0.12),0_4px_14px_rgba(0,0,0,0.12)]";

const MAX_CHIPS = 3;

/**
 * One workflow step, rendered as a bento-family card on the graph: title +
 * clamped description, READ chips (knowledge the step consults) and ACTION
 * chips (skills it runs), and a counts meta row. Entry steps (indegree 0)
 * wear an "entry" pill. Selecting opens the StepPanel.
 */
export function StepCard({
  step,
  position,
  isEntry,
  outCount,
  selected,
  dimmed,
  onSelect,
  registerRef,
}: Props) {
  const reads = step.reads.slice(0, MAX_CHIPS);
  const actions = step.actions.slice(0, MAX_CHIPS);

  return (
    <div
      ref={(el) => registerRef(step.id, el)}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(step.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(step.id);
        }
      }}
      className={cn(
        CARD_SHELL,
        selected ? CARD_SELECTED : CARD_RESTING,
        "cursor-pointer focus:outline-none"
      )}
      style={{
        left: position.x,
        top: position.y,
        width: position.width,
        opacity: dimmed ? 0.45 : 1,
      }}
    >
      <div className="px-3 pb-1.5 pt-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 line-clamp-2 text-body font-semibold tracking-tight text-text-primary">
            {step.title || "Untitled step"}
          </div>
          {isEntry && (
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-bg-inset px-2 py-px text-micro font-semibold uppercase tracking-wide text-text-secondary">
              <LogIn size={9} /> entry
            </span>
          )}
        </div>
        {step.description && (
          <div className="mt-0.5 line-clamp-2 text-caption leading-relaxed text-text-secondary">
            {step.description}
          </div>
        )}
      </div>

      {(reads.length > 0 || actions.length > 0) && (
        <div className="flex flex-col gap-1.5 px-3 pb-2">
          {reads.length > 0 && (
            <ChipRow>
              {reads.map((r, i) => (
                <span key={`r-${i}`} className={FLAT_CHIP} title={r.name}>
                  {r.kind === "file" ? <FileText size={9} /> : <BookText size={9} />}
                  <span className="min-w-0 truncate">{r.name}</span>
                </span>
              ))}
              {step.reads.length > MAX_CHIPS && (
                <span className="text-micro text-text-muted">
                  +{step.reads.length - MAX_CHIPS}
                </span>
              )}
            </ChipRow>
          )}
          {actions.length > 0 && (
            <ChipRow>
              {actions.map((a, i) => (
                <span key={`a-${i}`} className={FLAT_CHIP} title={a.name}>
                  <Zap size={9} />
                  <span className="min-w-0 truncate">{a.name}</span>
                </span>
              ))}
              {step.actions.length > MAX_CHIPS && (
                <span className="text-micro text-text-muted">
                  +{step.actions.length - MAX_CHIPS}
                </span>
              )}
            </ChipRow>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-1.5 text-micro text-text-muted">
        <span>{step.reads.length} knowledge</span>
        <span aria-hidden>·</span>
        <span>{step.actions.length} skills</span>
        <span aria-hidden>·</span>
        <span>{outCount} out</span>
      </div>
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-center gap-1">{children}</div>;
}

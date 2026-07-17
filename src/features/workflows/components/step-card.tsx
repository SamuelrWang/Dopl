"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { BookText, FileText, LogIn, Zap } from "lucide-react";
import type { NodeLayout } from "@/shared/graph";
import { cn } from "@/shared/lib/utils";
import type { PortSide } from "../graph/ports";
import type { WorkflowStep } from "../types";
import { FLAT_CHIP } from "./workflow-bits";

/** Connect-drag wiring for a card's ports (absent → no ports, viewers). */
export interface CardConnect {
  /** A connector drag is in progress somewhere on the graph. */
  active: boolean;
  /** This card is the drag source. */
  isSource: boolean;
  /** This card is the live drop target under the pointer. */
  isTarget: boolean;
  /** Start a connector drag from this card's port. */
  onPortPointerDown: (id: string, side: PortSide, e: ReactPointerEvent) => void;
}

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
  /** Starts a node drag (shared `useNodeDrag`). Absent → not draggable. */
  onPointerDown?: (id: string, e: ReactPointerEvent) => void;
  /** Live world-space offset while THIS card is the one being dragged. */
  dragOffset?: { dx: number; dy: number } | null;
  /** True while any card is dragging — swallows the post-drag click. */
  isDragging?: boolean;
  /** Drag-to-connect ports (absent → none rendered). */
  connect?: CardConnect;
}

// Layout shell only — the resting / selected / drop-target surface recipes
// are the shared `.graph-node*` kit classes (globals.css), applied per state.
const CARD_SHELL =
  "group absolute flex flex-col overflow-hidden rounded-xl border bg-bg-elevated text-left transition-shadow";

const MAX_CHIPS = 3;

/**
 * One workflow step, rendered as a bento-family card on the graph: title +
 * clamped description, READ chips (knowledge the step consults) and ACTION
 * chips (skills it runs), and a counts meta row. Entry steps (indegree 0)
 * wear an "entry" pill. The card body starts a node drag (reposition);
 * hovering reveals output/input ports that start a drag-to-connect. Clicking
 * (without dragging) opens the StepPanel.
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
  onPointerDown,
  dragOffset,
  isDragging = false,
  connect,
}: Props) {
  const reads = step.reads.slice(0, MAX_CHIPS);
  const actions = step.actions.slice(0, MAX_CHIPS);
  const lifted = dragOffset != null;
  const showPorts = connect != null && !lifted;
  const connecting = connect?.active ?? false;
  const isSource = connect?.isSource ?? false;

  const opacity = lifted
    ? 1
    : connecting
      ? isSource
        ? 0.9
        : 1
      : dimmed
        ? 0.45
        : 1;

  // Idle: both ports reveal on hover. While a connect-drag is live, show only
  // the output handle on the SOURCE card and only the input socket on every
  // other card — so a drop target reads unambiguously.
  const hoverReveal = "opacity-0 group-hover:opacity-100";
  const inputVisibility = !connecting
    ? hoverReveal
    : isSource
      ? "opacity-0 pointer-events-none"
      : "opacity-100";
  const outputVisibility = !connecting
    ? hoverReveal
    : isSource
      ? "opacity-100"
      : "opacity-0 pointer-events-none";

  return (
    <div
      ref={(el) => registerRef(step.id, el)}
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown ? (e) => onPointerDown(step.id, e) : undefined}
      onClick={() => {
        if (isDragging) return;
        onSelect(step.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(step.id);
        }
      }}
      className={cn(
        CARD_SHELL,
        connect?.isTarget ? "graph-node-target" : selected ? "graph-node-selected" : "graph-node",
        "focus:outline-none",
        onPointerDown ? "cursor-grab" : "cursor-pointer",
        lifted && "graph-node-lift"
      )}
      style={{
        left: position.x,
        top: position.y,
        width: position.width,
        opacity,
        transform: lifted ? `translate(${dragOffset.dx}px, ${dragOffset.dy}px)` : undefined,
        zIndex: lifted ? 10 : undefined,
      }}
    >
      {showPorts && (
        <>
          {/* Input socket (left) — a live drop target while connecting from
              another card. Purely visual; hit-testing is geometric. */}
          <span
            aria-hidden
            data-variant="input"
            data-target={connect!.isTarget ? "true" : undefined}
            className={cn(
              "graph-port pointer-events-none absolute left-0 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2",
              inputVisibility
            )}
          />
          {/* Output handle (right) — grab to start a connect. aria-hidden like
              the input: the gesture is convenience-only, the StepPanel's
              Connections section is the accessible path. */}
          <span
            aria-hidden
            data-variant="output"
            data-active={connect!.isSource ? "true" : undefined}
            onPointerDown={(e) => {
              e.stopPropagation();
              connect!.onPortPointerDown(step.id, "right", e);
            }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "graph-port absolute right-0 top-1/2 z-20 translate-x-1/2 -translate-y-1/2 cursor-crosshair",
              outputVisibility
            )}
          />
        </>
      )}

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

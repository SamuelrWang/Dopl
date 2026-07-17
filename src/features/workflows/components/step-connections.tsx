"use client";

import { ArrowRight, CornerDownRight, Plus, X } from "lucide-react";
import { SectionBox } from "@/shared/ui/section-box";
import { cn } from "@/shared/lib/utils";
import type { WorkflowGraph } from "../client/types";
import { PickMenu } from "./pick-menu";
import { FIELD_WELL } from "./workflow-bits";

interface Props {
  workflowId: string;
  stepId: string;
  graph: WorkflowGraph;
  canEdit: boolean;
  onConnect: (workflowId: string, from: string, to: string, condition: string) => void;
  onEditCondition: (workflowId: string, from: string, to: string, condition: string) => void;
  onDisconnect: (workflowId: string, from: string, to: string) => void;
  /** Create a brand-new step wired in from this one, then select it. */
  onAddNext: () => void;
  onSelectStep: (id: string) => void;
}

/**
 * Connections section: outgoing edges (target + inline branch condition +
 * disconnect) with an add-connection target picker, then incoming edges
 * listed read-only. A branch condition on an outgoing edge is the guard an
 * agent evaluates to decide whether to take that path.
 */
export function StepConnections({
  workflowId,
  stepId,
  graph,
  canEdit,
  onConnect,
  onEditCondition,
  onDisconnect,
  onAddNext,
  onSelectStep,
}: Props) {
  const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.title || "Untitled step";
  const outgoing = graph.edges.filter((e) => e.from === stepId);
  const incoming = graph.edges.filter((e) => e.to === stepId);
  const existingTargets = new Set(outgoing.map((e) => e.to));

  const targetItems = graph.nodes
    .filter((n) => n.id !== stepId && !existingTargets.has(n.id))
    .map((n) => ({ id: n.id, name: n.title || "Untitled step" }));

  return (
    <SectionBox
      label="Connections"
      meta={`${outgoing.length} out · ${incoming.length} in`}
      action={
        canEdit ? (
          <PickMenu
            items={targetItems}
            onPick={(to) => onConnect(workflowId, stepId, to, "")}
            emptyLabel="No other steps to connect to"
            trigger={
              <span className="flex items-center gap-1">
                <Plus size={11} /> Connect
              </span>
            }
            triggerClassName="btn-light flex h-6 items-center gap-1 rounded-md px-2 text-caption font-medium text-text-primary"
          />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2 px-3 py-3">
        {outgoing.length === 0 && incoming.length === 0 && (
          <p className="px-1 text-caption text-text-muted">
            Not connected yet. Connect this step to the one an agent should do next.
          </p>
        )}

        {outgoing.map((e) => (
          <div key={`out-${e.to}`} className="bento group flex flex-col gap-1.5 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <ArrowRight size={12} className="shrink-0 text-text-muted" />
              <button
                type="button"
                onClick={() => onSelectStep(e.to)}
                className="min-w-0 flex-1 truncate text-left text-body font-medium text-text-primary hover:underline"
              >
                {nameOf(e.to)}
              </button>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Disconnect ${nameOf(e.to)}`}
                  onClick={() => onDisconnect(workflowId, stepId, e.to)}
                  className="rounded-md p-1 text-text-muted opacity-0 transition hover:bg-surface-raised-3 hover:text-text-primary group-hover:opacity-100"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {canEdit ? (
              <input
                type="text"
                value={e.condition}
                onChange={(ev) => onEditCondition(workflowId, stepId, e.to, ev.target.value)}
                placeholder="branch condition (optional) — e.g. user approved…"
                className={cn(FIELD_WELL, "h-7 w-full px-2.5 text-caption text-text-primary placeholder:text-text-muted")}
                aria-label={`Condition for ${nameOf(e.to)}`}
              />
            ) : (
              e.condition && (
                <p className="px-1 text-caption text-text-secondary">
                  when <span className="font-medium">{e.condition}</span>
                </p>
              )
            )}
          </div>
        ))}

        {canEdit && (
          <button
            type="button"
            onClick={onAddNext}
            className="btn-light flex h-8 items-center justify-center gap-1.5 rounded-lg text-caption font-medium text-text-primary"
          >
            <CornerDownRight size={12} /> Add next step
          </button>
        )}

        {incoming.length > 0 && (
          <div className="mt-1 flex flex-col gap-1">
            <span className="px-1 text-label font-semibold uppercase tracking-wide text-text-muted">
              Comes from
            </span>
            {incoming.map((e) => (
              <button
                key={`in-${e.from}`}
                type="button"
                onClick={() => onSelectStep(e.from)}
                className="flex items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-surface-raised-2"
              >
                <ArrowRight size={11} className="shrink-0 text-text-disabled" />
                <span className="min-w-0 flex-1 truncate text-caption text-text-secondary">
                  {nameOf(e.from)}
                </span>
                {e.condition && (
                  <span className="shrink-0 truncate text-micro text-text-muted">
                    when {e.condition}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </SectionBox>
  );
}

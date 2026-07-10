"use client";

import { Columns3, Zap } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CHIP } from "@/features/ontology/components/ontology-bits";
import type { MockNode } from "../mock-data";

interface Props {
  node: MockNode;
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

/**
 * One node card on the graph. Column nodes render as compact group
 * headers (label strip + purpose + template chips); object nodes are
 * fuller bento cards with an inline attribute well and counts footer.
 */
export function GraphNode({ node, selected, dimmed, onSelect, registerRef }: Props) {
  const isColumn = node.kind === "column";

  return (
    <div
      ref={(el) => registerRef(node.id, el)}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(node.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(node.id);
        }
      }}
      className={cn(
        CARD_SHELL,
        selected ? CARD_SELECTED : CARD_RESTING,
        "cursor-pointer focus:outline-none"
      )}
      style={{ left: node.x, top: node.y, width: node.width, opacity: dimmed ? 0.45 : 1 }}
    >
      {isColumn ? <ColumnBody node={node} /> : <ObjectBody node={node} />}
    </div>
  );
}

function ColumnBody({ node }: { node: MockNode }) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border-default bg-card-surface-subtle px-3 py-1.5">
        <Columns3 size={12} className="text-text-muted" />
        <span className="truncate text-label font-semibold uppercase tracking-wide text-text-secondary">
          {node.name}
        </span>
        <span className="flex-1" />
        <span className="text-micro text-text-muted">column</span>
      </div>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {node.purpose && (
          <p className="text-caption leading-relaxed text-text-secondary">{node.purpose}</p>
        )}
        {node.template && node.template.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {node.template.map((field) => (
              <span
                key={field.label}
                className="rounded-full border border-border-default bg-bg-inset px-2 py-px text-micro font-medium text-text-secondary"
              >
                {field.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ObjectBody({ node }: { node: MockNode }) {
  const shown = node.attributes.slice(0, 4);
  return (
    <>
      <div className="px-3 pb-1.5 pt-2.5">
        <div className="truncate text-body font-semibold tracking-tight text-text-primary">
          {node.name}
        </div>
        {node.subtitle && (
          <div className="mt-0.5 truncate text-caption text-text-secondary">{node.subtitle}</div>
        )}
      </div>
      {shown.length > 0 && (
        <div className="mx-2.5 mb-2 rounded-lg border border-border-subtle bg-bg-inset px-2.5 py-2 shadow-[inset_0_2px_4px_rgba(0,0,0,0.06),inset_0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="flex flex-col gap-1">
            {shown.map((attr) => (
              <div key={attr.key} className="flex items-baseline gap-2 text-caption">
                <span className="w-20 shrink-0 truncate text-text-muted">{attr.label}</span>
                {attr.kind === "pill" ? (
                  <span className={cn(CHIP, "px-2 py-0 text-micro")}>{attr.display}</span>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-text-primary">
                    {attr.display}
                  </span>
                )}
              </div>
            ))}
            {node.attributes.length > shown.length && (
              <span className="text-micro text-text-muted">
                +{node.attributes.length - shown.length} more
              </span>
            )}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-1.5 text-micro text-text-muted">
        <span>{node.attributes.length} attrs</span>
        <span aria-hidden>·</span>
        <span>{node.relationships.reduce((n, r) => n + r.targetIds.length, 0)} edges</span>
        <span aria-hidden>·</span>
        <span>{node.actions.length} actions</span>
        {node.actions.length > 0 && (
          <>
            <span className="flex-1" />
            <Zap size={10} className="text-text-muted" />
          </>
        )}
      </div>
    </>
  );
}

"use client";

import { Columns3, Plus, Zap } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CHIP } from "../components/ontology-bits";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import type { GraphState } from "../graph-state";
import type { AttributeValue, OntologyObject } from "../types";
import type { NodeLayout, SceneNode } from "./types";

interface Props {
  node: SceneNode;
  position: NodeLayout;
  graph: GraphState;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  onAddCard: (columnId: string) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}

const CARD_SHELL =
  "absolute flex flex-col overflow-hidden rounded-xl border bg-bg-elevated text-left transition-shadow";
const CARD_RESTING =
  "border-border-default shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_12px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_6px_rgba(0,0,0,0.08),0_6px_16px_rgba(0,0,0,0.08)]";
const CARD_SELECTED =
  "border-border-highlight shadow-[0_0_0_1px_rgba(0,0,0,0.12),0_4px_14px_rgba(0,0,0,0.12)]";

/**
 * One node card on the graph, rendered from the live OntologyObject.
 * Column nodes are compact group headers (label strip + subtitle +
 * template chips + add-card button); object nodes are fuller bento
 * cards with an inline attribute well and counts footer.
 */
export function GraphNode({
  node,
  position,
  graph,
  selected,
  dimmed,
  onSelect,
  onAddCard,
  registerRef,
}: Props) {
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
      style={{
        left: position.x,
        top: position.y,
        width: position.width,
        opacity: dimmed ? 0.45 : 1,
      }}
    >
      {isColumn ? (
        <ColumnBody object={node.object} onAddCard={() => onAddCard(node.id)} />
      ) : (
        <ObjectBody object={node.object} graph={graph} />
      )}
    </div>
  );
}

function ColumnBody({ object, onAddCard }: { object: OntologyObject; onAddCard: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border-default bg-card-surface-subtle px-3 py-1.5">
        <Columns3 size={12} className="text-text-muted" />
        <span className="truncate text-label font-semibold uppercase tracking-wide text-text-secondary">
          {object.name || "Untitled column"}
        </span>
        <span className="flex-1" />
        <span className="text-micro text-text-muted">{object.childIds.length}</span>
        <button
          type="button"
          aria-label={`Add object to ${object.name || "column"}`}
          title="Add object"
          onClick={(e) => {
            e.stopPropagation();
            onAddCard();
          }}
          className="btn-light flex h-5 w-5 items-center justify-center rounded-md text-text-primary"
        >
          <Plus size={10} />
        </button>
      </div>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {object.subtitle && (
          <p className="text-caption leading-relaxed text-text-secondary">{object.subtitle}</p>
        )}
        {object.template.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {object.template.map((field) => (
              <span
                key={field.key}
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

function ObjectBody({ object, graph }: { object: OntologyObject; graph: GraphState }) {
  const { nameOf } = useWorkspaceResources();
  const shown = object.attributes.slice(0, 4);
  const edgeCount = object.relationships.reduce((n, r) => n + r.targetIds.length, 0);

  return (
    <>
      <div className="px-3 pb-1.5 pt-2.5">
        <div className="truncate text-body font-semibold tracking-tight text-text-primary">
          {object.name || "Untitled"}
        </div>
        {object.subtitle && (
          <div className="mt-0.5 truncate text-caption text-text-secondary">{object.subtitle}</div>
        )}
      </div>
      {shown.length > 0 && (
        <div className="mx-2.5 mb-2 rounded-lg border border-border-subtle bg-bg-inset px-2.5 py-2 shadow-[inset_0_2px_4px_rgba(0,0,0,0.06),inset_0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="flex flex-col gap-1">
            {shown.map((attr) => {
              const display = attributeDisplay(attr.value, graph, nameOf);
              return (
                <div key={attr.key} className="flex items-baseline gap-2 text-caption">
                  <span className="w-20 shrink-0 truncate text-text-muted">{attr.label}</span>
                  {display.chip ? (
                    <span className={cn(CHIP, "px-2 py-0 text-micro")}>{display.text}</span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-text-primary">
                      {display.text}
                    </span>
                  )}
                </div>
              );
            })}
            {object.attributes.length > shown.length && (
              <span className="text-micro text-text-muted">
                +{object.attributes.length - shown.length} more
              </span>
            )}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-1.5 text-micro text-text-muted">
        <span>{object.attributes.length} attrs</span>
        <span aria-hidden>·</span>
        <span>{edgeCount} edges</span>
        <span aria-hidden>·</span>
        <span>{object.methods.length} actions</span>
        {object.methods.length > 0 && (
          <>
            <span className="flex-1" />
            <Zap size={10} className="text-text-muted" />
          </>
        )}
      </div>
    </>
  );
}

function attributeDisplay(
  value: AttributeValue,
  graph: GraphState,
  nameOf: (id: string) => string | null
): { text: string; chip: boolean } {
  switch (value.kind) {
    case "text":
      return { text: value.value || "—", chip: false };
    case "pill":
      return { text: value.value || "—", chip: value.value.length > 0 };
    case "ref": {
      const names = value.value
        .map((id) => graph.objects[id]?.name)
        .filter((name): name is string => Boolean(name));
      return { text: names.length ? names.join(", ") : "—", chip: false };
    }
    case "knowledge":
    case "skill": {
      const names = value.value
        .map((id) => nameOf(id))
        .filter((name): name is string => name !== null);
      if (names.length) return { text: names.join(", "), chip: false };
      if (value.value.length) return { text: `${value.value.length} linked`, chip: true };
      return { text: "—", chip: false };
    }
  }
}

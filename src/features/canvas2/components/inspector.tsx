"use client";

import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SectionBox } from "@/shared/ui/section-box";
import { CHIP } from "@/features/ontology/components/ontology-bits";
import { containerNameOf, MOCK_NODES, type MockNode } from "../mock-data";

interface Props {
  node: MockNode;
  onSelect: (id: string) => void;
  onClose: () => void;
}

const KIND_LABEL: Record<string, string> = {
  text: "text",
  pill: "tag",
  ref: "object",
  knowledge: "knowledge",
  skill: "skill",
};

/**
 * Right-hand detail pane for the selected graph node — the ObjectPanel
 * shape (identity header + section boxes), read-only over mock data.
 */
export function Inspector({ node, onSelect, onClose }: Props) {
  const container = containerNameOf(node.id);
  const isColumn = node.kind === "column";

  return (
    <aside className="flex w-[400px] shrink-0 flex-col overflow-hidden border-l border-border-default">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <span className={cn(CHIP, "px-2 py-px text-micro")}>
          {isColumn ? "Column" : (container ?? "Object")}
        </span>
        <span className="truncate font-mono text-micro text-text-muted">{node.id}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="rounded-md p-1 text-text-muted transition hover:bg-surface-raised-2 hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6 pt-3.5">
        <div>
          <h2 className="text-title font-semibold tracking-tight text-text-primary">
            {node.name}
          </h2>
          {node.subtitle && (
            <p className="mt-0.5 text-body text-text-secondary">{node.subtitle}</p>
          )}
          {isColumn && node.purpose && (
            <p className="mt-1.5 text-caption leading-relaxed text-text-muted">{node.purpose}</p>
          )}
        </div>

        {isColumn && node.template && (
          <SectionBox label="Template" meta={`${node.template.length} fields`}>
            <div className="flex flex-col gap-1.5 p-3">
              {node.template.map((field) => (
                <div key={field.label} className="flex items-center gap-2 text-caption">
                  <span className="min-w-0 flex-1 truncate text-text-primary">{field.label}</span>
                  <span className="text-micro text-text-muted">{KIND_LABEL[field.kind]}</span>
                </div>
              ))}
            </div>
          </SectionBox>
        )}

        {!isColumn && (
          <SectionBox label="Attributes" meta={`${node.attributes.length}`}>
            <div className="flex flex-col gap-1.5 p-3">
              {node.attributes.length === 0 && (
                <p className="text-caption text-text-muted">No attributes yet.</p>
              )}
              {node.attributes.map((attr) => (
                <div key={attr.key} className="flex items-baseline gap-2 text-caption">
                  <span className="w-24 shrink-0 truncate text-text-muted">{attr.label}</span>
                  {attr.kind === "text" ? (
                    <span className="min-w-0 flex-1 truncate text-text-primary">
                      {attr.display}
                    </span>
                  ) : (
                    <span className={cn(CHIP, "px-2 py-0 text-micro")}>{attr.display}</span>
                  )}
                  <span className="shrink-0 text-micro text-text-disabled">
                    {KIND_LABEL[attr.kind]}
                  </span>
                </div>
              ))}
            </div>
          </SectionBox>
        )}

        <SectionBox
          label="Relationships"
          meta={`${node.relationships.reduce((n, r) => n + r.targetIds.length, 0)}`}
        >
          <div className="flex flex-col gap-2 p-3">
            {node.relationships.length === 0 && (
              <p className="text-caption text-text-muted">No relationships yet.</p>
            )}
            {node.relationships.map((rel) => (
              <div key={rel.label} className="flex flex-wrap items-center gap-1.5">
                <span className="text-caption font-medium text-text-secondary">{rel.label}</span>
                {rel.targetIds.map((targetId) => {
                  const target = MOCK_NODES.find((n) => n.id === targetId);
                  if (!target) return null;
                  return (
                    <button
                      key={targetId}
                      type="button"
                      onClick={() => onSelect(targetId)}
                      className={cn(CHIP, "transition hover:bg-bg-elevated-hover")}
                    >
                      {target.name}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </SectionBox>

        <SectionBox label="Actions" meta={`${node.actions.length}`}>
          <div className="flex flex-col gap-2 p-3">
            {node.actions.length === 0 && (
              <p className="text-caption text-text-muted">No actions yet.</p>
            )}
            {node.actions.map((action) => (
              <div
                key={action.name}
                className="rounded-lg border border-border-default bg-bg-elevated px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
              >
                <div className="text-body font-semibold text-text-primary">{action.name}</div>
                <p className="mt-0.5 text-caption text-text-secondary">{action.description}</p>
                <div className="mt-1.5 flex flex-col gap-0.5 text-micro text-text-muted">
                  <span>
                    <span className="font-semibold uppercase tracking-wide">Outcome</span>{" "}
                    {action.outcome}
                  </span>
                  <span>
                    <span className="font-semibold uppercase tracking-wide">Tools</span>{" "}
                    {action.tools}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SectionBox>
      </div>
    </aside>
  );
}

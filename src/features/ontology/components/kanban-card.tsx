"use client";

import { useState } from "react";
import { ChevronDown, CornerDownRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { GraphState } from "../graph-state";
import { TypeDot } from "./ontology-bits";

interface Props {
  objectId: string;
  graph: GraphState;
  selected: boolean;
  onSelect: (id: string) => void;
}

/**
 * Compact card in a type column. Click selects (opens the editor
 * panel); the chevron drops the card open inline — key attributes and
 * the objects nested inside it.
 */
export function KanbanCard({ objectId, graph, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const object = graph.objects[objectId];
  if (!object) return null;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-[#fbfcfd] transition-shadow",
        selected
          ? "border-black/[0.2] shadow-[0_0_0_1px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.08)]"
          : "border-black/[0.1] shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:shadow-[0_2px_6px_rgba(0,0,0,0.08)]"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(objectId)}
        className="flex w-full items-start gap-2 px-3 pt-2.5 pb-1 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold tracking-tight text-[#232a31]">
            {object.name}
          </div>
          {object.subtitle && (
            <div className="mt-0.5 truncate text-[11.5px] text-[#646d78]">
              {object.subtitle}
            </div>
          )}
        </div>
        <span
          role="button"
          tabIndex={0}
          aria-label={open ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setOpen((o) => !o);
            }
          }}
          className="rounded-md p-1 text-[#98a2ad] transition hover:bg-black/[0.05] hover:text-[#232a31]"
        >
          <ChevronDown
            size={13}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </span>
      </button>
      <div className="flex items-center gap-2 px-3 pb-2 text-[10.5px] text-[#98a2ad]">
        <span>{object.attributes.length} attrs</span>
        <span aria-hidden>·</span>
        <span>{object.relationships.length} edges</span>
        <span aria-hidden>·</span>
        <span>{object.methods.length} actions</span>
        {object.childIds.length > 0 && (
          <>
            <span aria-hidden>·</span>
            <span className="font-medium text-[#646d78]">
              {object.childIds.length} inside
            </span>
          </>
        )}
      </div>

      {open && (
        <div className="border-t border-black/[0.06] bg-[#eef1f5] px-3 py-2 shadow-[inset_0_2px_4px_rgba(0,0,0,0.08),inset_0_1px_2px_rgba(0,0,0,0.05)]">
          {object.attributes.length > 0 && (
            <div className="flex flex-col gap-1">
              {object.attributes.slice(0, 4).map((attr) => (
                <div key={attr.key} className="flex items-baseline gap-2 text-[11.5px]">
                  <span className="w-24 shrink-0 truncate text-[#98a2ad]">
                    {attr.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[#232a31]">
                    {attr.value.kind === "files"
                      ? `${attr.value.value.length} file${attr.value.value.length === 1 ? "" : "s"}`
                      : attr.value.value || "—"}
                  </span>
                </div>
              ))}
              {object.attributes.length > 4 && (
                <span className="text-[10.5px] text-[#98a2ad]">
                  +{object.attributes.length - 4} more
                </span>
              )}
            </div>
          )}
          {object.childIds.length > 0 && (
            <div className="mt-2 flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[#98a2ad]">
                Inside
              </span>
              {object.childIds.map((childId) => {
                const child = graph.objects[childId];
                if (!child) return null;
                return (
                  <button
                    key={childId}
                    type="button"
                    onClick={() => onSelect(childId)}
                    className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] text-[#646d78] transition hover:bg-black/[0.04] hover:text-[#232a31]"
                  >
                    <CornerDownRight size={10} className="shrink-0 text-[#98a2ad]" />
                    <TypeDot type={child.type} />
                    <span className="truncate">{child.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

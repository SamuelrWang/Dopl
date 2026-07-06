"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import type { GraphState } from "../graph-state";
import { TypeDot } from "./ontology-bits";

const PANEL_W = 264;
const PANEL_MAX_H = 384;

interface Props {
  graph: GraphState;
  onPick: (id: string) => void;
  /** Ids that shouldn't be pickable (e.g. the object being edited). */
  excludeIds?: string[];
  trigger: ReactNode;
  triggerClassName?: string;
}

/**
 * Tiered object picker in ONE panel: hovering a cluster row expands its
 * columns beneath it; hovering a column row expands its objects beneath
 * that. Columns and objects are pickable; clusters only expand.
 */
export function CascadeSelect({
  graph,
  onPick,
  excludeIds = [],
  trigger,
  triggerClassName,
}: Props) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [columnId, setColumnId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const excluded = new Set(excludeIds);

  const close = () => {
    setAnchor(null);
    setClusterId(null);
    setColumnId(null);
  };

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor]);

  const pick = (id: string) => {
    onPick(id);
    close();
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor((prev) => (prev ? null : { x: rect.left, y: rect.bottom + 6 }));
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {anchor &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={rootRef}
            className="fixed z-[9999] overflow-y-auto rounded-xl border border-black/[0.12] bg-[#fbfcfd] p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_10px_28px_rgba(0,0,0,0.14)]"
            style={{
              width: PANEL_W,
              maxHeight: PANEL_MAX_H,
              left: Math.min(anchor.x, window.innerWidth - PANEL_W - 16),
              top: Math.min(anchor.y, window.innerHeight - PANEL_MAX_H - 16),
            }}
          >
            <div className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#98a2ad]">
              Link an object
            </div>
            {graph.clusters.map((c) => {
              const clusterOpen = c.id === clusterId;
              return (
                <div key={c.id}>
                  <Row
                    depth={0}
                    expanded={clusterOpen}
                    hasChildren={c.columnIds.length > 0}
                    onHover={() => {
                      setClusterId(c.id);
                      setColumnId(null);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                    <span className="text-[10px] text-[#98a2ad]">{c.columnIds.length}</span>
                  </Row>
                  {clusterOpen &&
                    c.columnIds.map((cid) => {
                      const col = graph.objects[cid];
                      if (!col) return null;
                      const colOpen = cid === columnId;
                      return (
                        <div key={cid}>
                          <Row
                            depth={1}
                            expanded={colOpen}
                            hasChildren={col.childIds.length > 0}
                            disabled={excluded.has(cid)}
                            onHover={() => setColumnId(cid)}
                            onPick={excluded.has(cid) ? undefined : () => pick(cid)}
                          >
                            <TypeDot type={col.type} />
                            <span className="min-w-0 flex-1 truncate">{col.name}</span>
                            <span className="text-[10px] text-[#98a2ad]">
                              {col.childIds.length}
                            </span>
                          </Row>
                          {colOpen &&
                            col.childIds.map((oid) => {
                              const obj = graph.objects[oid];
                              if (!obj) return null;
                              return (
                                <Row
                                  key={oid}
                                  depth={2}
                                  disabled={excluded.has(oid)}
                                  onPick={excluded.has(oid) ? undefined : () => pick(oid)}
                                >
                                  <TypeDot type={obj.type} />
                                  <span className="min-w-0 flex-1 truncate">{obj.name}</span>
                                </Row>
                              );
                            })}
                          {colOpen && col.childIds.length === 0 && (
                            <p className="py-1 pr-2 pl-12 text-[12px] text-[#98a2ad]">
                              No objects yet
                            </p>
                          )}
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

function Row({
  children,
  depth,
  expanded,
  hasChildren,
  disabled,
  onHover,
  onPick,
}: {
  children: ReactNode;
  depth: number;
  expanded?: boolean;
  hasChildren?: boolean;
  disabled?: boolean;
  onHover?: () => void;
  onPick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled && !hasChildren}
      onMouseEnter={onHover}
      onClick={onPick}
      style={{ paddingLeft: 8 + depth * 16 }}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-[13px] transition-colors",
        expanded
          ? "bg-[#e9e9e7] font-medium text-[#232a31] shadow-[inset_0_1px_2px_rgba(0,0,0,0.1),inset_0_-1px_0_rgba(255,255,255,0.7),0_0_0_1px_rgba(0,0,0,0.04)]"
          : disabled
            ? "cursor-default text-[#c4cad1]"
            : "text-[#646d78] hover:bg-black/[0.04] hover:text-[#232a31]",
        onPick && !disabled && "cursor-pointer"
      )}
    >
      {children}
      {hasChildren && (
        <ChevronRight
          size={12}
          className={cn(
            "shrink-0 text-[#98a2ad] transition-transform",
            expanded && "rotate-90"
          )}
        />
      )}
    </button>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import type { GraphState } from "../graph-state";
import { TypeDot } from "./ontology-bits";

const PANEL_W = 224;

interface Props {
  graph: GraphState;
  onPick: (id: string) => void;
  /** Ids that shouldn't be pickable (e.g. the object being edited). */
  excludeIds?: string[];
  trigger: ReactNode;
  triggerClassName?: string;
}

/**
 * Tiered object picker: clusters → columns → objects. Hovering a row
 * opens the next tier to the right; columns are themselves pickable.
 * Portal-positioned below the trigger, clamped to the viewport.
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

  const cluster = clusterId
    ? (graph.clusters.find((c) => c.id === clusterId) ?? null)
    : null;
  const column = columnId ? (graph.objects[columnId] ?? null) : null;

  const pick = (id: string) => {
    onPick(id);
    close();
  };

  const tiers = 1 + (cluster ? 1 : 0) + (column ? 1 : 0);

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
            className="fixed z-[9999] flex items-start"
            style={{
              left: Math.min(anchor.x, window.innerWidth - tiers * (PANEL_W + 6) - 16),
              top: Math.min(anchor.y, window.innerHeight - 320),
            }}
          >
            <Panel label="Ontology">
              {graph.clusters.map((c) => (
                <Row
                  key={c.id}
                  active={c.id === clusterId}
                  hasChildren
                  onHover={() => {
                    setClusterId(c.id);
                    setColumnId(null);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-[10px] text-[#98a2ad]">{c.columnIds.length}</span>
                </Row>
              ))}
            </Panel>

            {cluster && (
              <Panel label={cluster.name}>
                {cluster.columnIds.map((cid) => {
                  const col = graph.objects[cid];
                  if (!col) return null;
                  return (
                    <Row
                      key={cid}
                      active={cid === columnId}
                      hasChildren={col.childIds.length > 0}
                      disabled={excluded.has(cid)}
                      onHover={() => setColumnId(cid)}
                      onPick={excluded.has(cid) ? undefined : () => pick(cid)}
                    >
                      <TypeDot type={col.type} />
                      <span className="min-w-0 flex-1 truncate">{col.name}</span>
                      <span className="text-[10px] text-[#98a2ad]">{col.childIds.length}</span>
                    </Row>
                  );
                })}
                {cluster.columnIds.length === 0 && <Empty text="No columns yet" />}
              </Panel>
            )}

            {column && (
              <Panel label={column.name}>
                {column.childIds.map((oid) => {
                  const obj = graph.objects[oid];
                  if (!obj) return null;
                  return (
                    <Row
                      key={oid}
                      disabled={excluded.has(oid)}
                      onPick={excluded.has(oid) ? undefined : () => pick(oid)}
                    >
                      <TypeDot type={obj.type} />
                      <span className="min-w-0 flex-1 truncate">{obj.name}</span>
                    </Row>
                  );
                })}
                {column.childIds.length === 0 && <Empty text="No objects yet" />}
              </Panel>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="mr-1.5 max-h-80 overflow-y-auto rounded-xl border border-black/[0.12] bg-[#fbfcfd] p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_10px_28px_rgba(0,0,0,0.14)]"
      style={{ width: PANEL_W }}
    >
      <div className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#98a2ad]">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  children,
  active,
  hasChildren,
  disabled,
  onHover,
  onPick,
}: {
  children: ReactNode;
  active?: boolean;
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
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
        active
          ? "bg-[#e9e9e7] font-medium text-[#232a31] shadow-[inset_0_1px_2px_rgba(0,0,0,0.1),inset_0_-1px_0_rgba(255,255,255,0.7),0_0_0_1px_rgba(0,0,0,0.04)]"
          : disabled
            ? "cursor-default text-[#c4cad1]"
            : "text-[#646d78] hover:bg-black/[0.04] hover:text-[#232a31]",
        onPick && !disabled && "cursor-pointer"
      )}
    >
      {children}
      {hasChildren && <ChevronRight size={12} className="shrink-0 text-[#98a2ad]" />}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-2 py-1.5 text-[12px] text-[#98a2ad]">{text}</p>;
}

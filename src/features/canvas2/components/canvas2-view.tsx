"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";
import {
  MOCK_CLUSTER,
  MOCK_EDGES,
  MOCK_NODES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../mock-data";
import { EdgeLayer, type NodeRect } from "./edge-layer";
import { GraphNode } from "./graph-node";
import { Inspector } from "./inspector";

/**
 * Canvas 2 — static mock of the ontology-as-graph page. Hardcoded
 * nodes/edges, click-to-select with an ObjectPanel-style inspector;
 * no drag, no zoom, no persistence. Node heights are content-driven,
 * so edge anchors are measured from the DOM after mount.
 */
export function Canvas2View() {
  const [selectedId, setSelectedId] = useState<string | null>("obj-find-qualify");
  const [rects, setRects] = useState<Record<string, NodeRect>>({});
  const nodeEls = useRef<Map<string, HTMLDivElement>>(new Map());

  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) nodeEls.current.set(id, el);
    else nodeEls.current.delete(id);
  }, []);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const measured: Record<string, NodeRect> = {};
      nodeEls.current.forEach((el, id) => {
        measured[id] = {
          x: el.offsetLeft,
          y: el.offsetTop,
          width: el.offsetWidth,
          height: el.offsetHeight,
        };
      });
      setRects(measured);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const selected = MOCK_NODES.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="page-float flex flex-col antialiased">
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
        <div className="concave-track flex items-center gap-1">
          <button
            type="button"
            className="raised-tab flex h-6 items-center gap-1.5 rounded-[6px] px-2.5 text-caption font-medium text-text-primary"
          >
            {MOCK_CLUSTER.name}
            <span className="text-micro text-text-muted">3</span>
          </button>
          <button
            type="button"
            className="flex h-6 items-center rounded-[6px] px-2.5 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            New cluster
            <span className="ml-1.5 text-micro text-text-muted">1</span>
          </button>
        </div>
        <p className="min-w-0 flex-1 truncate text-body text-text-secondary">
          {MOCK_CLUSTER.purpose}
        </p>
        <Legend />
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          className="relative min-w-0 flex-1 overflow-auto bg-bg-inset shadow-[inset_0_2px_6px_rgba(0,0,0,0.06)]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
        >
          <div
            className="relative"
            style={{
              width: WORLD_WIDTH,
              height: WORLD_HEIGHT,
              backgroundImage: "radial-gradient(rgba(35,42,49,0.07) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedId(null);
            }}
          >
            <EdgeLayer edges={MOCK_EDGES} rects={rects} focusId={selectedId} />
            {MOCK_NODES.map((node) => (
              <GraphNode
                key={node.id}
                node={node}
                selected={node.id === selectedId}
                dimmed={
                  selectedId !== null &&
                  node.id !== selectedId &&
                  !MOCK_EDGES.some(
                    (e) =>
                      (e.from === selectedId && e.to === node.id) ||
                      (e.to === selectedId && e.from === node.id)
                  )
                }
                onSelect={setSelectedId}
                registerRef={registerRef}
              />
            ))}
          </div>
        </div>
        {selected && (
          <div className="absolute bottom-3 right-3 top-3 z-20 w-[400px]">
            <Inspector
              node={selected}
              onSelect={setSelectedId}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const LEGEND: Array<{ label: string; className: string }> = [
  { label: "contains", className: "border-t border-dashed border-border-highlight" },
  { label: "relationship", className: "border-t-[1.5px] border-text-secondary" },
  { label: "ref", className: "border-t border-dotted border-text-muted" },
];

function Legend() {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {LEGEND.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={cn("w-5", item.className)} aria-hidden />
          <span className="text-micro text-text-muted">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

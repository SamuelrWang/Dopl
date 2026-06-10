"use client";

/**
 * NodePortsLayer — connector ports for node panels, rendered in WORLD
 * space as siblings of the panels (panels clip their children via
 * overflow-hidden, so ports can't live inside them).
 *
 * Each node gets an IN port on its left edge (drop target) and an OUT
 * port on its right edge (drag source — see useEdgeDrag). Ports
 * inverse-scale slightly is unnecessary: at world scale they zoom with
 * the panels, which reads naturally.
 */

import { useCapabilities } from "../canvas-store";
import { useEdgeDrag } from "./use-edge-drag";
import type { Panel } from "../types";

const PORT_SIZE = 14;

export function NodePortsLayer({ panels }: { panels: Panel[] }) {
  const beginEdgeDrag = useEdgeDrag();
  // Read-only canvases (shared cluster viewer) render no ports — edge
  // authoring is an editor affordance.
  const { canMove } = useCapabilities();
  const nodes = panels.filter((p) => p.type === "node");
  if (!canMove || nodes.length === 0) return null;

  return (
    <>
      {nodes.map((p) => {
        const midY = p.y + p.height / 2 - PORT_SIZE / 2;
        return (
          <div key={`ports-${p.id}`}>
            {/* IN port — drop target (left edge) */}
            <div
              data-edge-port="in"
              data-port-panel-id={p.id}
              title="Connect from another node"
              // Don't let a press on the port fall through to the
              // viewport — it would start a marquee (or drag the whole
              // cluster, since the port straddles the panel edge).
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute rounded-full border-2 border-[#5b82b0] bg-[var(--panel-surface)] transition-transform data-[port-active=true]:scale-150 data-[port-active=true]:bg-[#5b82b0]"
              style={{
                left: p.x - PORT_SIZE / 2,
                top: midY,
                width: PORT_SIZE,
                height: PORT_SIZE,
              }}
            />
            {/* OUT port — drag source (right edge) */}
            <div
              data-edge-port="out"
              data-port-panel-id={p.id}
              title="Drag to connect to another node"
              onPointerDown={(e) => beginEdgeDrag(e, p.id)}
              className="absolute rounded-full border-2 border-[#5b82b0] bg-[#5b82b0] cursor-crosshair hover:scale-125 transition-transform"
              style={{
                left: p.x + p.width - PORT_SIZE / 2,
                top: midY,
                width: PORT_SIZE,
                height: PORT_SIZE,
              }}
            />
          </div>
        );
      })}
    </>
  );
}

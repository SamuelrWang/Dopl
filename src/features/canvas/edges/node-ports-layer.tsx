"use client";

/**
 * NodePortsLayer — connector dots for node + workflow-header panels,
 * rendered in WORLD space as siblings of the panels (panels clip their
 * children via overflow-hidden, so the dots can't live inside them).
 *
 * One dot per side, centered ON the panel edge (the edge runs through
 * the middle of the dot), always visible, and stacked ABOVE the panels
 * (z-index) so a dot is never hidden under its own or a neighbouring
 * panel. Nodes expose all four sides; the workflow header exposes a
 * single bottom dot. Drag out of any dot to start a connection; drop
 * anywhere on another node/workflow panel to finish it — direction (the
 * arrow) follows drag order.
 *
 * Scale-on-hover is composed INTO the same transform as the centering
 * translate (arbitrary-value Tailwind classes): a bare `scale-*` utility
 * would REPLACE the translate and visually fling the dot toward the
 * panel's top-left corner.
 */

import { useCapabilities } from "../canvas-store";
import { useEdgeDrag } from "./use-edge-drag";
import { SIDES, SITE_FRACTIONS, sitePoint, type Side } from "./anchors";
import type { Panel } from "../types";

const SITE_SIZE = 14;

export function NodePortsLayer({ panels }: { panels: Panel[] }) {
  const { canMove } = useCapabilities();

  const connectable = panels.filter(
    (p) => p.type === "node" || p.type === "workflow"
  );
  const connectableIds = new Set(connectable.map((p) => p.id));
  const beginDrag = useEdgeDrag({
    // State-derived membership beats sniffing data-* attributes off the
    // DOM — the drop test can't silently break if panel markup changes.
    isConnectable: (id) => connectableIds.has(id),
  });

  // Read-only canvases (shared viewer) render no dots — edge authoring
  // is an editor affordance.
  if (!canMove || connectable.length === 0) return null;

  return (
    <>
      {connectable.map((panel) => {
        const sides: Side[] = panel.type === "workflow" ? ["bottom"] : SIDES;
        return sides.map((side) =>
          SITE_FRACTIONS.map((frac) => {
            const pt = sitePoint(panel, side, frac);
            return (
              <div
                key={`${panel.id}-${side}-${frac}`}
                data-edge-site="true"
                data-port-panel-id={panel.id}
                data-site-side={side}
                data-site-frac={frac}
                title="Drag to connect"
                onPointerDown={(e) => beginDrag(e, panel.id, side, frac)}
                className="absolute rounded-full bg-[var(--panel-header-text)] border-2 border-[#5b82b0] transition-transform duration-150 [transform:translate(-50%,-50%)] hover:[transform:translate(-50%,-50%)_scale(1.3)] data-[port-active=true]:[transform:translate(-50%,-50%)_scale(1.45)]"
                style={{
                  left: pt.x,
                  top: pt.y,
                  width: SITE_SIZE,
                  height: SITE_SIZE,
                  cursor: "crosshair",
                  // Above the panels (selected panels sit at z 10) so the
                  // dot is never buried under its own or a neighbour's box.
                  zIndex: 11,
                  // Without this, touch/pen gestures get claimed for
                  // scrolling and fire pointercancel — edge drawing would
                  // silently never work on touch devices.
                  touchAction: "none",
                }}
              />
            );
          })
        );
      })}
    </>
  );
}

"use client";

/**
 * useEdgeDrag — drag a connector from a node's OUT port to another
 * node's IN port.
 *
 * Pointer-based (no dnd-kit, matching the canvas convention). The ghost
 * line is drawn in SCREEN space — a fixed, pointer-transparent SVG
 * appended to document.body for the duration of the drag — so it needs
 * no camera math. On pointerup over `[data-edge-port="in"]` of a
 * different panel, dispatches EDGE_ADD with a client-generated uuid
 * (the db-sync hook persists it immediately).
 */

import { useCallback } from "react";
import type React from "react";
import { useCanvas } from "../canvas-store";

export function useEdgeDrag(): (
  e: React.PointerEvent,
  fromPanelId: string
) => void {
  const { dispatch } = useCanvas();

  return useCallback(
    (e: React.PointerEvent, fromPanelId: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      const pointerId = e.pointerId;

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      Object.assign(svg.style, {
        position: "fixed",
        inset: "0",
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: "99999",
      });
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#5b82b0");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-dasharray", "6 4");
      path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);
      document.body.appendChild(svg);

      let hoverPort: HTMLElement | null = null;

      function clearHover() {
        if (hoverPort) {
          delete hoverPort.dataset.portActive;
          hoverPort = null;
        }
      }

      function onMove(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        const bend = Math.max(40, Math.abs(ev.clientX - startX) / 2);
        path.setAttribute(
          "d",
          `M ${startX} ${startY} C ${startX + bend} ${startY}, ${ev.clientX - bend} ${ev.clientY}, ${ev.clientX} ${ev.clientY}`
        );

        let found: HTMLElement | null = null;
        for (const el of document.elementsFromPoint(ev.clientX, ev.clientY)) {
          const portEl = (el as HTMLElement).closest?.(
            '[data-edge-port="in"]'
          ) as HTMLElement | null;
          if (portEl && portEl.dataset.portPanelId !== fromPanelId) {
            found = portEl;
            break;
          }
        }
        if (found !== hoverPort) {
          clearHover();
          if (found) {
            found.dataset.portActive = "true";
            hoverPort = found;
          }
        }
      }

      function teardown() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      }

      function onCancel(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        // Aborted gesture: clean up without creating an edge.
        teardown();
        clearHover();
        svg.remove();
      }

      function onUp(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        teardown();
        const toPanelId = hoverPort?.dataset.portPanelId;
        clearHover();
        svg.remove();
        if (toPanelId && toPanelId !== fromPanelId) {
          dispatch({
            type: "EDGE_ADD",
            edge: {
              id: crypto.randomUUID(),
              fromPanelId,
              toPanelId,
            },
          });
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [dispatch]
  );
}

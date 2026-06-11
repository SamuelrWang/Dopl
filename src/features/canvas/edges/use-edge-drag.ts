"use client";

/**
 * useEdgeDrag — drag a connector out of one panel's site and drop it onto
 * another node / workflow panel to create a directed edge (the arrow
 * points the way it was dragged).
 *
 * Pointer-based (no dnd-kit, matching the canvas convention). The ghost
 * line is drawn in SCREEN space — a fixed, pointer-transparent SVG
 * appended to document.body for the duration of the drag — so it needs no
 * camera math.
 *
 * Drop target = the whole node/workflow PANEL under the cursor (not the
 * tiny port dot): the panel is a big, always-interactive hit area, so the
 * connection lands reliably regardless of zoom or whether the precise dot
 * is under the cursor. On pointerup over a different node/workflow panel,
 * dispatches EDGE_ADD (the db-sync hook persists it immediately).
 *
 * onStart/onEnd let the ports layer reveal every site while a drag is in
 * flight so the user can see where connections can land.
 */

import { useCallback } from "react";
import type React from "react";
import { useCanvas } from "../canvas-store";
import type { Side } from "./anchors";

const STROKE = "#5b82b0";

export function useEdgeDrag(opts?: {
  onStart?: () => void;
  onEnd?: () => void;
  /** Store-derived check for valid drop panels. Falls back to sniffing
   *  `data-panel-type` when omitted. */
  isConnectable?: (panelId: string) => boolean;
}): (
  e: React.PointerEvent,
  fromPanelId: string,
  side: Side,
  frac: number
) => void {
  const { dispatch } = useCanvas();
  const onStart = opts?.onStart;
  const onEnd = opts?.onEnd;
  const isConnectable = opts?.isConnectable;

  return useCallback(
    (e: React.PointerEvent, fromPanelId: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      const pointerId = e.pointerId;
      // Capture so releasing outside the window still fires pointerup —
      // without it the ghost line sticks to the cursor with no button
      // held. Captured events retarget to the site but still bubble to
      // the window listeners below.
      try {
        (e.currentTarget as Element).setPointerCapture(pointerId);
      } catch {
        // Element detached mid-press — in-window releases still work.
      }
      onStart?.();

      // Plain dashed STRAIGHT line while dragging — no arrowhead and no
      // curve until the connection actually commits (the rendered edge
      // adds both).
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
      path.setAttribute("stroke", STROKE);
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-dasharray", "6 4");
      path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);
      document.body.appendChild(svg);

      let target: HTMLElement | null = null;
      /** The landing dot lit on the hovered target panel. */
      let activeDot: HTMLElement | null = null;

      function clearTarget() {
        if (activeDot) {
          delete activeDot.dataset.portActive;
          activeDot = null;
        }
        target = null;
      }

      /**
       * Light the target panel's connector dot nearest the cursor —
       * a precise "the line will land here" cue instead of outlining
       * the whole panel.
       */
      function highlightNearestDot(panelId: string, ev: PointerEvent) {
        let best: HTMLElement | null = null;
        let bestD = Infinity;
        document
          .querySelectorAll<HTMLElement>(
            `[data-edge-site][data-port-panel-id="${panelId}"]`
          )
          .forEach((dot) => {
            const r = dot.getBoundingClientRect();
            const d = Math.hypot(
              r.left + r.width / 2 - ev.clientX,
              r.top + r.height / 2 - ev.clientY
            );
            if (d < bestD) {
              bestD = d;
              best = dot;
            }
          });
        if (best !== activeDot) {
          if (activeDot) delete activeDot.dataset.portActive;
          if (best) (best as HTMLElement).dataset.portActive = "true";
          activeDot = best;
        }
      }

      /**
       * Drop target under the cursor: a connector DOT or a node/workflow
       * panel body, whichever is hit. The dot check is load-bearing —
       * dots are world-layer SIBLINGS of the panels, centered on the
       * panel edge, so a dot-to-dot drop's release point is often
       * outside the panel box entirely; matching only `[data-panel-id]`
       * made exactly-on-the-dot drops (the most natural gesture) miss.
       * Returns the element carrying the target panel id in its dataset.
       */
      function panelAt(x: number, y: number): HTMLElement | null {
        for (const el of document.elementsFromPoint(x, y)) {
          // Connector dot hit — `data-port-panel-id` names its panel.
          const siteEl = (el as HTMLElement).closest?.(
            "[data-edge-site]"
          ) as HTMLElement | null;
          if (siteEl) {
            const siteId = siteEl.dataset.portPanelId;
            if (siteId && siteId !== fromPanelId) return siteEl;
            continue; // own panel's dot — keep scanning the stack
          }
          // Panel body hit.
          const panelEl = (el as HTMLElement).closest?.(
            "[data-panel-id]"
          ) as HTMLElement | null;
          if (!panelEl) continue;
          const id = panelEl.dataset.panelId;
          if (!id || id === fromPanelId) continue;
          const ok = isConnectable
            ? isConnectable(id)
            : panelEl.dataset.panelType === "node" ||
              panelEl.dataset.panelType === "workflow";
          if (ok) return panelEl;
        }
        return null;
      }

      /** Target panel id off whichever element panelAt returned. */
      function targetIdOf(el: HTMLElement | null): string | undefined {
        return el?.dataset.portPanelId ?? el?.dataset.panelId;
      }

      function onMove(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        path.setAttribute(
          "d",
          `M ${startX} ${startY} L ${ev.clientX} ${ev.clientY}`
        );

        const found = panelAt(ev.clientX, ev.clientY);
        if (found !== target) {
          clearTarget();
          target = found;
        }
        const foundId = targetIdOf(found);
        if (foundId) {
          highlightNearestDot(foundId, ev);
        }
      }

      function teardown() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        onEnd?.();
      }

      function onCancel(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        teardown();
        clearTarget();
        svg.remove();
      }

      function onUp(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        teardown();
        // Resolve the drop target from the release point (not just the last
        // hovered one) so a fast release still connects.
        const dropEl = panelAt(ev.clientX, ev.clientY) ?? target;
        const toPanelId = targetIdOf(dropEl);
        clearTarget();
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
    [dispatch, onStart, onEnd, isConnectable]
  );
}

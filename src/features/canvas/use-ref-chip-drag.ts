"use client";

/**
 * useRefChipDrag — drag a reference chip (e.g. a file row inside a KB
 * panel's tree) onto a node block's dock zone.
 *
 * Pointer-based, mirroring the canvas's no-dnd-kit convention:
 *   - pointerdown arms the drag; nothing visible happens until the
 *     cursor moves past a small threshold (so plain clicks still open
 *     the file as before)
 *   - past the threshold, a ghost chip follows the cursor and dock
 *     zones light up via [data-dock-active] when hovered
 *   - pointerup over a compatible zone dispatches NODE_DOCK_REF;
 *     anywhere else just cleans up
 *   - a one-shot click-capture listener suppresses the row's click when
 *     a real drag happened
 *
 * File refs only dock into "read" zones; skill refs (future callers)
 * into "action" — derived from the ref kind.
 */

import { useCallback } from "react";
import type React from "react";
import { useCanvas } from "./canvas-store";
import type { NodeRef } from "./types";

const DRAG_THRESHOLD_PX = 6;

export function useRefChipDrag(): (
  e: React.PointerEvent,
  ref: NodeRef
) => void {
  const { dispatch } = useCanvas();

  return useCallback(
    (e: React.PointerEvent, ref: NodeRef) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const pointerId = e.pointerId;
      const zone = ref.kind === "skill" ? "action" : "read";

      let ghost: HTMLDivElement | null = null;
      let dockEl: HTMLElement | null = null;
      let dragged = false;

      function clearDock() {
        if (dockEl) {
          delete dockEl.dataset.dockActive;
          dockEl = null;
        }
      }

      function onMove(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        if (
          !dragged &&
          Math.hypot(ev.clientX - startX, ev.clientY - startY) <
            DRAG_THRESHOLD_PX
        ) {
          return;
        }
        if (!dragged) {
          dragged = true;
          ghost = document.createElement("div");
          ghost.textContent = ref.name;
          Object.assign(ghost.style, {
            position: "fixed",
            zIndex: "99999",
            pointerEvents: "none",
            padding: "4px 10px",
            borderRadius: "8px",
            background: "#ffffff",
            border: "1px solid rgba(0,0,0,0.12)",
            boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
            font: "500 12px var(--font-geist-sans, sans-serif)",
            color: "#232a31",
            maxWidth: "220px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          } satisfies Partial<CSSStyleDeclaration>);
          document.body.appendChild(ghost);
        }
        if (ghost) {
          ghost.style.left = `${ev.clientX + 10}px`;
          ghost.style.top = `${ev.clientY + 8}px`;
        }

        let found: HTMLElement | null = null;
        for (const el of document.elementsFromPoint(ev.clientX, ev.clientY)) {
          const zoneEl = (el as HTMLElement).closest?.(
            `[data-dock-zone="${zone}"]`
          ) as HTMLElement | null;
          if (zoneEl) {
            found = zoneEl;
            break;
          }
        }
        if (found !== dockEl) {
          clearDock();
          if (found) {
            found.dataset.dockActive = "true";
            dockEl = found;
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
        // Aborted gesture (system gesture, window blur): clean up
        // WITHOUT docking — the platform canceled, the user didn't drop.
        teardown();
        clearDock();
        ghost?.remove();
      }

      function onUp(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        teardown();
        const targetNodeId = dockEl?.dataset.dockPanelId;
        clearDock();
        ghost?.remove();
        if (dragged) {
          // Swallow the click that follows pointerup so the row's
          // click-to-open doesn't also fire after a drag. The click (if
          // any) dispatches synchronously in the same input sequence, so
          // a 0-tick timeout safely removes the suppressor afterwards —
          // without it, a drag that produced NO click (pointer released
          // outside the window) would leave the capture listener armed
          // and swallow the user's next unrelated click.
          const suppress = (ce: MouseEvent) => {
            ce.stopPropagation();
            ce.preventDefault();
          };
          window.addEventListener("click", suppress, { capture: true });
          setTimeout(
            () =>
              window.removeEventListener("click", suppress, {
                capture: true,
              }),
            0
          );
        }
        if (dragged && targetNodeId) {
          dispatch({
            type: "NODE_DOCK_REF",
            panelId: targetNodeId,
            zone,
            ref,
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

"use client";

import React, { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import { useCanvasStateRef, useCapabilities } from "./canvas-store";
import { computeIdealClusterMembership } from "./clusters/cluster-geometry";
import {
  isPanelClusterable,
  type CanvasAction,
  type NodeRef,
  type Panel,
} from "./types";

/**
 * Does this element have a non-whitespace DIRECT text child? Used to block
 * drag when the user clicks on a bare text-bearing element (like a <span>
 * wrapping "Saved" or a tag chip) — we want them to be able to select that
 * text without starting a panel drag.
 *
 * Only looks at direct children so a layout `<div>` containing other
 * elements (spans, icons) still drags from its padding.
 */
function hasDirectTextContent(el: Element): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text && text.trim().length > 0) return true;
    }
  }
  return false;
}

/**
 * Panel drag logic: pointer-down decision (ignore text selections and
 * interactive controls; drag plain or header regions), pointer-move
 * applies the cursor delta to every panel captured at drag start, and
 * pointer-up releases capture + resets state.
 *
 * Also runs the cluster membership re-computation on every move so
 * panels auto-enter/leave clusters based on spatial proximity. The
 * moving-panels-are-all-one-cluster short-circuit avoids surprise
 * re-clustering when the user deliberately drags a whole cluster.
 *
 * The click-vs-drag decision (used to collapse multi-selection on a
 * plain click while preserving it on a group drag) is handled inside
 * the hook's pointer-up handler — callers don't need to thread a ref.
 *
 * Returns {isDragging, handleRootPointerDown, handleRootPointerMove,
 * handleRootPointerUp}. isDragging drives the cursor swap (grab ↔
 * grabbing); the three handlers wire to the panel root's pointer
 * events.
 */
export function useCanvasPanelDrag(
  panel: Panel,
  dispatch: Dispatch<CanvasAction>
) {
  const canvasStateRef = useCanvasStateRef();
  const capabilities = useCapabilities();

  // Drag origin captures the STARTING positions (and sizes) of every
  // panel that will move together (solo = just this panel; group = all
  // selected panels when the user drags a member of a multi-selection).
  // pointermove applies the cursor delta to each panel's starting
  // position, and uses the sizes to re-compute cluster membership based
  // on the panels' new bounding boxes.
  const dragOriginRef = useRef<{
    mouseX: number;
    mouseY: number;
    panels: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  } | null>(null);

  // Drives the cursor swap from `grab` to `grabbing` while the user is
  // actively dragging the panel. Using React state (vs the :active
  // pseudo-class) makes this work with setPointerCapture — the cursor
  // stays as `grabbing` for the entire drag, even as the pointer moves
  // over elements that would normally have their own cursor.
  const [isDragging, setIsDragging] = useState(false);
  // Track whether the pointer actually moved during this gesture so we
  // can distinguish "click on a multi-selected panel" (collapse selection)
  // from "drag a multi-selected group" (keep selection).
  const didDragRef = useRef(false);

  // Node-dock target under the cursor during a solo KB/skill panel drag.
  // The zone element is highlighted imperatively via [data-dock-active]
  // (no React state — this runs every pointermove frame).
  const dockTargetRef = useRef<{
    el: HTMLElement;
    nodePanelId: string;
    zone: "read" | "action";
  } | null>(null);

  const clearDockTarget = useCallback(() => {
    const current = dockTargetRef.current;
    if (current) {
      delete current.el.dataset.dockActive;
      dockTargetRef.current = null;
    }
  }, []);

  const handleRootPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Always stop propagation — the panel eats pointerdown so the canvas
      // marquee never sees it, regardless of whether we drag or not.
      e.stopPropagation();

      // ── Selection update ─────────────────────────────────────────
      const currentSelection = canvasStateRef.current.selectedPanelIds;
      const alreadySelected = currentSelection.includes(panel.id);

      if (e.shiftKey) {
        // Shift-click toggles membership — never starts a drag.
        const nextSelection = alreadySelected
          ? currentSelection.filter((id) => id !== panel.id)
          : [...currentSelection, panel.id];
        dispatch({ type: "SET_SELECTION", panelIds: nextSelection });
        return;
      }

      // Plain click on a panel that's part of a multi-selection: keep
      // the selection intact so the user can drag the group. We'll
      // collapse to [panel.id] on pointerup if no drag occurred.
      if (!(currentSelection.length > 1 && alreadySelected)) {
        dispatch({ type: "SET_SELECTION", panelIds: [panel.id] });
      }

      if (e.button !== 0) return;
      const targetEl = e.target as HTMLElement;

      // 1. Form controls always win — click, focus, etc. This comes first
      //    so the close button inside the header still works.
      const interactive = targetEl.closest(
        'button, a[href], input, textarea, select, label, [role="button"], [role="link"], [contenteditable="true"]'
      );
      if (interactive) return;

      // 2. The header is a dedicated drag handle — ALWAYS draggable, even
      //    if the user is clicking on the title text. This is the classic
      //    "window title bar" behavior. Headers are marked with
      //    `data-drag-handle` on the wrapping div.
      const insideDragHandle = targetEl.closest("[data-drag-handle]");
      if (insideDragHandle) {
        if (!capabilities.canMove) return;
        beginDrag(e);
        return;
      }

      // 3. Explicit opt-outs (chat input wrapper).
      if (targetEl.closest("[data-no-drag]")) return;

      // 4. Semantic text tags — let native text selection win.
      if (
        targetEl.closest("h1, h2, h3, h4, h5, h6, p, pre, code, li, blockquote")
      ) {
        return;
      }

      // 5. Bare text elements (<span>, <div> with direct text). Spans are
      //    also used for layout wrappers / icons, so we can't blacklist
      //    them entirely. Instead, check if the clicked element has
      //    non-whitespace text as a direct child.
      if (hasDirectTextContent(targetEl)) return;

      if (!capabilities.canMove) return;
      beginDrag(e);

      function beginDrag(evt: React.PointerEvent<HTMLDivElement>) {
        const target = evt.currentTarget;
        target.setPointerCapture(evt.pointerId);

        // If this panel is part of a multi-selection, drag ALL selected
        // panels together. Otherwise solo-drag just this panel.
        const sel = canvasStateRef.current.selectedPanelIds;
        const isPartOfMultiSelect = sel.length > 1 && sel.includes(panel.id);
        const panelsToCapture = isPartOfMultiSelect
          ? canvasStateRef.current.panels
              .filter((p) => sel.includes(p.id))
              .map((p) => ({
                id: p.id,
                x: p.x,
                y: p.y,
                width: p.width,
                height: p.height,
              }))
          : [
              {
                id: panel.id,
                x: panel.x,
                y: panel.y,
                width: panel.width,
                height: panel.height,
              },
            ];

        dragOriginRef.current = {
          mouseX: evt.clientX,
          mouseY: evt.clientY,
          panels: panelsToCapture,
        };
        didDragRef.current = false;
        setIsDragging(true);
        // Body-wide grabbing cursor — works even when the pointer strays
        // over text children or off the panel mid-drag (pointer capture
        // keeps events flowing to us, but the native cursor otherwise
        // follows whatever element is under the physical pointer).
        if (typeof document !== "undefined") {
          document.body.classList.add("panel-dragging");
        }
      }
    },
    [dispatch, panel, canvasStateRef, capabilities.canMove]
  );

  const handleRootPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const origin = dragOriginRef.current;
      if (!origin) return;
      didDragRef.current = true;
      // Cursor deltas are in screen pixels; panel positions are in world
      // coords. Divide by zoom so panels track the cursor 1:1 visually
      // at any zoom level.
      const zoom = canvasStateRef.current.camera.zoom;
      const dx = (e.clientX - origin.mouseX) / zoom;
      const dy = (e.clientY - origin.mouseY) / zoom;

      // Apply the same delta to every panel captured at drag start —
      // this covers both solo drags (origin.panels has one entry) and
      // group drags (origin.panels has N entries) through the same
      // MOVE_PANELS dispatch.
      dispatch({
        type: "MOVE_PANELS",
        moves: origin.panels.map((p) => ({
          id: p.id,
          x: p.x + dx,
          y: p.y + dy,
        })),
      });

      // ── Node dock-zone hit-test ────────────────────────────────────
      // Solo drags of a KB / skill panel can dock into a node block's
      // Read / Action zone. elementsFromPoint returns the full stack,
      // so the dragged panel's own elements (under the cursor) are
      // skipped by requiring a zone that belongs to a DIFFERENT panel.
      if (
        origin.panels.length === 1 &&
        (panel.type === "knowledge-base" || panel.type === "skill")
      ) {
        const wantZone = panel.type === "knowledge-base" ? "read" : "action";
        let found: HTMLElement | null = null;
        for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
          const zoneEl = (el as HTMLElement).closest?.(
            `[data-dock-zone="${wantZone}"]`
          ) as HTMLElement | null;
          if (zoneEl && zoneEl.dataset.dockPanelId !== panel.id) {
            found = zoneEl;
            break;
          }
        }
        const current = dockTargetRef.current;
        if (found !== (current?.el ?? null)) {
          clearDockTarget();
          if (found && found.dataset.dockPanelId) {
            found.dataset.dockActive = "true";
            dockTargetRef.current = {
              el: found,
              nodePanelId: found.dataset.dockPanelId,
              zone: wantZone,
            };
          }
        }
      }

      // ── Cluster membership re-computation ─────────────────────────
      // After updating positions, decide whether each moved panel
      // should enter / leave / stay in its current cluster based on
      // distance to other members. Membership checks are cheap (small
      // N) so running them every frame is fine. Both dispatches are
      // batched into the same React render by v18 auto-batching.
      const latestState = canvasStateRef.current;
      const movingIds = new Set(origin.panels.map((p) => p.id));

      // Build a "virtual" panels array with moved panels' NEW positions
      // applied so the membership checker sees the post-move layout.
      const virtualPanels = latestState.panels.map((p) => {
        const moved = origin.panels.find((m) => m.id === p.id);
        if (!moved) return p;
        return { ...p, x: moved.x + dx, y: moved.y + dy };
      });

      // If this drag is a cluster drag (every member of a cluster is
      // in the moving set), skip the membership checks — rigid group
      // moves can't change distances between members. This also avoids
      // surprising reclusters when the user intentionally moves a
      // whole cluster as one.
      const allMovingBelongToOneCluster = (() => {
        const firstCluster = latestState.clusters.find((c) =>
          c.panelIds.some((id) => movingIds.has(id))
        );
        if (!firstCluster) return false;
        // Every moving panel must be in the same cluster AND every
        // member of that cluster must be moving.
        if (!firstCluster.panelIds.every((id) => movingIds.has(id))) {
          return false;
        }
        return origin.panels.every((p) =>
          firstCluster.panelIds.includes(p.id)
        );
      })();

      if (allMovingBelongToOneCluster) return;

      for (const moved of origin.panels) {
        // Non-clusterable panels (connection, browse) skip membership checks.
        const movedPanel = latestState.panels.find((p) => p.id === moved.id);
        if (movedPanel && !isPanelClusterable(movedPanel)) continue;
        // Cluster-info panels are pinned to their own cluster — dragging
        // one repositions it (the outline follows) but never re-homes it
        // into a spatially-nearer cluster.
        if (movedPanel?.type === "cluster-info") continue;

        const currentCluster = latestState.clusters.find((c) =>
          c.panelIds.includes(moved.id)
        );
        const currentId = currentCluster?.id ?? null;
        const idealId = computeIdealClusterMembership(
          moved.id,
          virtualPanels,
          latestState.clusters
        );
        if (idealId === currentId) continue;
        if (idealId === null) {
          dispatch({ type: "REMOVE_PANEL_FROM_CLUSTER", panelId: moved.id });
        } else {
          dispatch({
            type: "ADD_PANEL_TO_CLUSTER",
            panelId: moved.id,
            clusterId: idealId,
          });
        }
      }
    },
    [dispatch, canvasStateRef, panel.type, panel.id, clearDockTarget]
  );

  const handleRootPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }

      // ── Dock on drop ──────────────────────────────────────────────
      // Dropping a KB / skill panel onto a node zone converts the panel
      // into a docked reference: the ref lands in the node's field and
      // the dragged panel leaves the canvas. pointercancel (the platform
      // ABORTED the gesture) must never commit a dock — that would
      // delete the dragged panel on an unintentional gesture.
      const wasCanceled = e.type === "pointercancel";
      const dock = dockTargetRef.current;
      if (dock && didDragRef.current && !wasCanceled) {
        let ref: NodeRef | null = null;
        if (panel.type === "knowledge-base") {
          ref = {
            kind: "kb",
            kbId: panel.knowledgeBaseId,
            name: panel.name,
          };
        } else if (panel.type === "skill") {
          ref = { kind: "skill", skillId: panel.skillId, name: panel.name };
        }
        if (ref) {
          dispatch({
            type: "NODE_DOCK_REF",
            panelId: dock.nodePanelId,
            zone: dock.zone,
            ref,
          });
          dispatch({ type: "CLOSE_PANEL", id: panel.id });
        }
      }
      clearDockTarget();
      // If the user clicked (not dragged) a panel that was part of a
      // multi-selection, collapse the selection down to just this panel.
      // (Skipped for canceled gestures — a cancel is not a click.)
      if (!didDragRef.current && !wasCanceled) {
        const sel = canvasStateRef.current.selectedPanelIds;
        if (sel.length > 1 && sel.includes(panel.id)) {
          dispatch({ type: "SET_SELECTION", panelIds: [panel.id] });
        }
      }
      dragOriginRef.current = null;
      didDragRef.current = false;
      setIsDragging(false);
      if (typeof document !== "undefined") {
        document.body.classList.remove("panel-dragging");
      }
    },
    [dispatch, panel, canvasStateRef, clearDockTarget]
  );

  // Safety net: if this panel unmounts mid-drag (e.g. user clicks Close,
  // keyboard delete, realtime removal), make sure we don't leave the
  // body stuck in `panel-dragging` or a node zone stuck highlighted.
  useEffect(() => {
    return () => {
      if (typeof document !== "undefined") {
        document.body.classList.remove("panel-dragging");
      }
      clearDockTarget();
    };
  }, [clearDockTarget]);

  return {
    isDragging,
    handleRootPointerDown,
    handleRootPointerMove,
    handleRootPointerUp,
  };
}

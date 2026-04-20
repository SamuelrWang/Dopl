"use client";

/**
 * CanvasPanel — generic draggable wrapper for any panel type.
 *
 * Provides:
 *  - World-coordinate positioning (absolute left/top)
 *  - Liquid-glass chrome (matches the chat input box style)
 *  - Header with drag handle, title, and close button
 *  - Routes the panel.type to the correct body component
 *
 * Drag behavior:
 *  - The ENTIRE panel is a drag surface — header, body padding, empty space.
 *  - Drag is automatically blocked when the pointerdown target is interactive
 *    (button, link, input, textarea) or is over text content (h*, p, span,
 *    code, pre, li — via `cursor: text` set by globals.css).
 *  - The decision lives in handleRootPointerDown, which reads the target's
 *    computed `cursor` style. CSS and JS stay in sync this way: if the
 *    cursor says "text" the user sees a caret AND drag is blocked; if it
 *    says "pointer" they see a click hand AND drag is blocked; if it says
 *    "grab" they see a hand AND drag fires.
 */

import React, { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import { useCanvasStateRef, useCapabilities } from "./canvas-store";
import { computeIdealClusterMembership } from "./clusters/cluster-geometry";
import { ChatPanelBody } from "./panels/chat/chat-panel";
import { ConnectionPanelBody } from "./panels/connection-panel";
import { EntryPanelBody } from "./panels/entry-panel";
import { BrowsePanelBody } from "./panels/browse/browse-panel";
import { ClusterBrainPanel } from "./panels/cluster-brain/cluster-brain-panel";
import { useOnboardingContext } from "@/components/onboarding/onboarding-provider";
import { BROWSE_PANEL_MIN_SIZE, isPanelClusterable, isPanelDeletable, type CanvasAction, type ChatPanelData, type Panel } from "./types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface CanvasPanelProps {
  panel: Panel;
  isSelected: boolean;
  dispatch: Dispatch<CanvasAction>;
}

/**
 * Elements whose pointerdown should never start a panel drag. Native form
 * controls, explicit opt-outs via `data-no-drag`, and semantic text tags
 * that the user should be able to select and copy from.
 *
 * We use a pure selector-based check (not `getComputedStyle().cursor`)
 * because it doesn't depend on globals.css being loaded — the JS works
 * even before the stylesheet has hydrated, and there's no cascade/specificity
 * surprise to debug.
 */
const DRAG_BLOCK_SELECTOR = [
  // Interactive controls
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "label",
  '[role="button"]',
  '[role="link"]',
  '[contenteditable="true"]',
  // Explicit opt-outs (e.g. chat input container)
  "[data-no-drag]",
  // Semantic text tags — the user is clicking on content they might
  // want to select/copy, so let native text selection win over drag.
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "pre",
  "code",
  "li",
  "blockquote",
].join(",");

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

function CanvasPanelInner({ panel, isSelected, dispatch }: CanvasPanelProps) {
  // Onboarding highlight — pulse glow if this panel type is the current target
  const { highlightPanelType } = useOnboardingContext();
  const isHighlighted = highlightPanelType === panel.type;

  // Stable ref to the latest canvas state — used for imperative drag
  // logic without subscribing to re-renders.
  const canvasStateRef = useCanvasStateRef();

  // Viewer capabilities. On the main /canvas these are always true; on
  // the shared cluster viewer non-owners get canMove=false / canDelete=false.
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
    [dispatch]
  );

  const handleRootPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
      // If the user clicked (not dragged) a panel that was part of a
      // multi-selection, collapse the selection down to just this panel.
      if (!didDragRef.current) {
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
    [dispatch, panel.id, canvasStateRef]
  );

  // ── Resize logic (browse panels only) ────────────────────────────
  // Supports edges (n, s, e, w) and corners (ne, nw, se, sw).
  type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
  const resizeOriginRef = useRef<{
    mouseX: number;
    mouseY: number;
    x: number;
    y: number;
    width: number;
    height: number;
    edge: ResizeEdge;
  } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const handleEdgePointerDown = useCallback(
    (edge: ResizeEdge) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeOriginRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        x: panel.x,
        y: panel.y,
        width: panel.width,
        height: panel.height,
        edge,
      };
      setIsResizing(true);
    },
    [panel.x, panel.y, panel.width, panel.height]
  );

  const handleEdgePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const origin = resizeOriginRef.current;
      if (!origin) return;
      const zoom = canvasStateRef.current.camera.zoom;
      const dx = (e.clientX - origin.mouseX) / zoom;
      const dy = (e.clientY - origin.mouseY) / zoom;
      const { edge } = origin;
      const minW = BROWSE_PANEL_MIN_SIZE.width;
      const minH = BROWSE_PANEL_MIN_SIZE.height;

      let newX = origin.x;
      let newY = origin.y;
      let newW = origin.width;
      let newH = origin.height;

      // East edge — grow right
      if (edge.includes("e")) newW = Math.max(minW, origin.width + dx);
      // West edge — grow left (move x, shrink width)
      if (edge.includes("w")) {
        newW = Math.max(minW, origin.width - dx);
        newX = origin.x + (origin.width - newW);
      }
      // South edge — grow down
      if (edge === "s" || edge === "se" || edge === "sw") newH = Math.max(minH, origin.height + dy);
      // North edge — grow up (move y, shrink height)
      if (edge === "n" || edge === "ne" || edge === "nw") {
        newH = Math.max(minH, origin.height - dy);
        newY = origin.y + (origin.height - newH);
      }

      dispatch({ type: "RESIZE_PANEL", id: panel.id, width: newW, height: newH });
      if (newX !== origin.x || newY !== origin.y) {
        dispatch({ type: "MOVE_PANEL", id: panel.id, x: newX, y: newY });
      }
    },
    [dispatch, panel.id, canvasStateRef]
  );

  const handleEdgePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
      resizeOriginRef.current = null;
      setIsResizing(false);
    },
    []
  );

  // Safety net: if this panel unmounts mid-drag (e.g. user clicks Close),
  // make sure we don't leave the body stuck in `panel-dragging`.
  useEffect(() => {
    return () => {
      if (typeof document !== "undefined") {
        document.body.classList.remove("panel-dragging");
      }
    };
  }, []);

  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const handleClose = useCallback(() => {
    // Chat panels: close is now non-destructive. The conversation stays
    // in the DB (on its 7-day timer for unpinned chats, indefinite for
    // pinned), and the user can re-open it from the chat drawer. We
    // simply remove the canvas panel; the sync layer DELETEs the
    // canvas_panels row, leaving the conversations row untouched.
    dispatch({ type: "CLOSE_PANEL", id: panel.id });
  }, [dispatch, panel]);

  const handleConfirmClose = useCallback(() => {
    // Legacy path — close is now non-destructive, so this just closes
    // the canvas panel. The dialog is no longer wired up for chats, but
    // we keep the handler in case it's reached via another path.
    dispatch({ type: "CLOSE_PANEL", id: panel.id });
    setShowCloseConfirm(false);
  }, [dispatch, panel.id]);

  const deletable = isPanelDeletable(panel) && capabilities.canDelete;
  const headerTitle =
    panel.type === "chat"
      ? panel.title
      : panel.type === "connection"
        ? "API & MCP Connection"
        : panel.type === "entry"
          ? `Entry · ${panel.title}`
          : panel.type === "browse"
            ? "Browse Entries"
            : panel.type === "cluster-brain"
              ? `Brain · ${panel.clusterName}`
              : "Panel";

  return (
    <div
      data-panel-id={panel.id}
      data-panel-type={panel.type}
      data-panel-selected={isSelected || undefined}
      style={{
        position: "absolute",
        left: panel.x,
        top: panel.y,
        width: panel.width,
        height: panel.height,
        // Inline cursor beats any Tailwind utility or preflight. The
        // globals.css rules on text/buttons/inputs override children via
        // their own specified cursor (not inheritance), so those still
        // work on top of this. Swaps to `grabbing` for the duration of
        // an active drag so the cursor stays scrunched while the user
        // holds the mouse button.
        cursor: isResizing ? "nwse-resize" : isDragging ? "grabbing" : "grab",
        // Selected panel comes to the front of the z-stack so dragging it
        // glides above other panels (and its highlighted border isn't
        // clipped by neighbours). Keeping the baseline at 0 avoids
        // creating a stacking context for every panel.
        zIndex: isSelected ? 10 : 0,
        // Promote each panel to its own GPU compositing layer. Without
        // this, fast pinch-zoom looks glitchy because the ancestor's
        // scale transform forces the CPU to re-rasterize every panel
        // on each wheel tick. With translateZ(0)
        // + will-change: transform, the panel lives on a pre-composited
        // texture and the ancestor's scale just re-samples it — no
        // filter re-run per frame.
        transform: "translateZ(0)",
        willChange: "transform",
        backfaceVisibility: "hidden",
      }}
      // Whole-panel drag surface. handleRootPointerDown decides whether to
      // initiate a drag or defer to native handling by inspecting the target.
      onPointerDown={handleRootPointerDown}
      onPointerMove={handleRootPointerMove}
      onPointerUp={handleRootPointerUp}
      onPointerCancel={handleRootPointerUp}
      // `select-text` overrides the canvas viewport's `select-none` so the
      // user can highlight and copy text inside the panel. (Without this,
      // the viewport-level `user-select: none` inherits into the panel and
      // blocks every text selection.)
      //
      // Selected state: keep the original hairline border; add an OUTER
      // gray ring via box-shadow spread so the panel looks like it's
      // sitting on top of a slightly larger gray surface. Because the ring
      // is a shadow, it doesn't affect layout and follows the panel's
      // rounded corners automatically.
      className={
        "relative rounded-2xl overflow-hidden bg-[var(--panel-surface)] border border-white/[0.1] flex flex-col select-text transition-[box-shadow] duration-150 " +
        (isSelected
          ? "shadow-[0_0_0_2px_rgba(255,255,255,0.5),0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.08)] !border-white/30"
          : "shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.08)]") +
        (isHighlighted ? " onboarding-highlight" : "")
      }
    >
      {/* Top specular highlight */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 30%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.3) 70%, transparent 100%)",
        }}
      />

      {/* Header — dedicated drag handle. Marked with `data-drag-handle` so
          the root pointer-down handler always treats this region as a drag
          zone, even over the title text. Inline `cursor: grab` overrides
          the `[data-panel-id] span { cursor: text }` rule that would
          otherwise apply to the title span. `select-none` keeps the title
          from being selectable — the header is for dragging, not reading. */}
      <div
        data-drag-handle
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
        className="shrink-0 flex items-center gap-2 px-4 h-10 border-b border-white/[0.06] select-none"
      >
        {/* Drag indicator dots */}
        <div
          className="flex flex-col gap-[2px] shrink-0 mr-1"
          aria-hidden
        >
          <div className="flex gap-[2px]">
            <span className="w-[3px] h-[3px] rounded-none bg-white/30" />
            <span className="w-[3px] h-[3px] rounded-none bg-white/30" />
          </div>
          <div className="flex gap-[2px]">
            <span className="w-[3px] h-[3px] rounded-none bg-white/30" />
            <span className="w-[3px] h-[3px] rounded-none bg-white/30" />
          </div>
          <div className="flex gap-[2px]">
            <span className="w-[3px] h-[3px] rounded-none bg-white/30" />
            <span className="w-[3px] h-[3px] rounded-none bg-white/30" />
          </div>
        </div>

        <span
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
          className="font-mono text-[10px] uppercase tracking-wide text-white/70 truncate flex-1"
        >
          {headerTitle}
        </span>

        {deletable ? (
          <button
            onClick={handleClose}
            aria-label="Close panel"
            className="w-6 h-6 flex items-center justify-center rounded-[3px] text-white/40 hover:text-white/90 hover:bg-white/[0.06] border border-transparent hover:border-white/[0.1] transition-colors"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        ) : (
          // Pinned indicator — communicates "always present, no close button"
          <span
            aria-label="Pinned panel"
            title="Pinned — cannot be closed"
            className="w-6 h-6 flex items-center justify-center text-white/30"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 1l1.5 3.5L11 5l-2.5 2L9 11 6 9l-3 2 .5-4L1 5l3.5-.5z" />
            </svg>
          </span>
        )}
      </div>

      {/* Timer / pin bar for chat panels */}
      {panel.type === "chat" && panel.messages.length > 0 && (
        <ChatExpiryBar panel={panel} dispatch={dispatch} />
      )}

      {/* Body — routes by panel type */}
      <div className="flex-1 min-h-0 flex flex-col">
        {panel.type === "chat" && <ChatPanelBody panel={panel} />}
        {panel.type === "connection" && <ConnectionPanelBody panel={panel} />}
        {panel.type === "entry" && <EntryPanelBody panel={panel} />}
        {panel.type === "browse" && <BrowsePanelBody panel={panel} />}
        {panel.type === "cluster-brain" && <ClusterBrainPanel panel={panel} />}
      </div>

      {/* Confirmation dialog for closing chat panels with messages */}
      {showCloseConfirm && (
        <Dialog open onOpenChange={(open) => { if (!open) setShowCloseConfirm(false); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Delete chat history?</DialogTitle>
              <DialogDescription>
                By closing this, you will delete this entire chat history. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCloseConfirm(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirmClose}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Resize edges & corners — browse panels only */}
      {panel.type === "browse" && (
        <>
          {/* Edge zones — 6px wide invisible hit areas along each border */}
          {/* Top */}
          <div onPointerDown={handleEdgePointerDown("n")} onPointerMove={handleEdgePointerMove} onPointerUp={handleEdgePointerUp} onPointerCancel={handleEdgePointerUp} style={{ cursor: "ns-resize" }} className="absolute top-0 left-3 right-3 h-[6px]" />
          {/* Bottom */}
          <div onPointerDown={handleEdgePointerDown("s")} onPointerMove={handleEdgePointerMove} onPointerUp={handleEdgePointerUp} onPointerCancel={handleEdgePointerUp} style={{ cursor: "ns-resize" }} className="absolute bottom-0 left-3 right-3 h-[6px]" />
          {/* Left */}
          <div onPointerDown={handleEdgePointerDown("w")} onPointerMove={handleEdgePointerMove} onPointerUp={handleEdgePointerUp} onPointerCancel={handleEdgePointerUp} style={{ cursor: "ew-resize" }} className="absolute left-0 top-3 bottom-3 w-[6px]" />
          {/* Right */}
          <div onPointerDown={handleEdgePointerDown("e")} onPointerMove={handleEdgePointerMove} onPointerUp={handleEdgePointerUp} onPointerCancel={handleEdgePointerUp} style={{ cursor: "ew-resize" }} className="absolute right-0 top-3 bottom-3 w-[6px]" />
          {/* Corner zones — 12px squares at each corner */}
          <div onPointerDown={handleEdgePointerDown("nw")} onPointerMove={handleEdgePointerMove} onPointerUp={handleEdgePointerUp} onPointerCancel={handleEdgePointerUp} style={{ cursor: "nwse-resize" }} className="absolute top-0 left-0 w-3 h-3" />
          <div onPointerDown={handleEdgePointerDown("ne")} onPointerMove={handleEdgePointerMove} onPointerUp={handleEdgePointerUp} onPointerCancel={handleEdgePointerUp} style={{ cursor: "nesw-resize" }} className="absolute top-0 right-0 w-3 h-3" />
          <div onPointerDown={handleEdgePointerDown("sw")} onPointerMove={handleEdgePointerMove} onPointerUp={handleEdgePointerUp} onPointerCancel={handleEdgePointerUp} style={{ cursor: "nesw-resize" }} className="absolute bottom-0 left-0 w-3 h-3" />
          <div onPointerDown={handleEdgePointerDown("se")} onPointerMove={handleEdgePointerMove} onPointerUp={handleEdgePointerUp} onPointerCancel={handleEdgePointerUp} style={{ cursor: "nwse-resize" }} className="absolute bottom-0 right-0 w-3 h-3" />
        </>
      )}
    </div>
  );
}

export const CanvasPanel = React.memo(CanvasPanelInner);

// ── Chat expiry bar ──────────────────────────────────────────────────

function formatTimeRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expiring soon";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `Expires in ${days}d ${hours}h`;
  return `Expires in ${hours}h`;
}

function ChatExpiryBar({
  panel,
  dispatch,
}: {
  panel: ChatPanelData;
  dispatch: React.Dispatch<CanvasAction>;
}) {
  const isPinned = panel.pinned ?? false;

  const handleTogglePin = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      dispatch({
        type: "SET_CHAT_PINNED",
        panelId: panel.id,
        pinned: !isPinned,
      });
    },
    [dispatch, panel.id, isPinned]
  );

  return (
    <div className="shrink-0 flex items-center justify-between px-4 h-6 border-b border-white/[0.04] bg-white/[0.02]">
      <span className="font-mono text-[9px] uppercase tracking-wider text-white/30">
        {isPinned
          ? "Pinned"
          : panel.expiresAt
            ? formatTimeRemaining(panel.expiresAt)
            : "Expires in 7d 0h"}
      </span>
      <button
        onClick={handleTogglePin}
        aria-label={isPinned ? "Unpin chat" : "Pin chat"}
        title={isPinned ? "Unpin — will auto-delete after 7 days" : "Pin — keep forever"}
        className="w-5 h-5 flex items-center justify-center rounded-[2px] text-white/30 hover:text-white/70 transition-colors"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill={isPinned ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M5 1v6M3 3l2-2 2 2M2 7h6M5 7v2" />
        </svg>
      </button>
    </div>
  );
}

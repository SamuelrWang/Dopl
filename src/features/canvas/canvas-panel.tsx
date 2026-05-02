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
 * Drag + resize are handled by the sibling hooks `use-canvas-panel-drag`
 * and `use-canvas-panel-resize`. See those files for the interactive
 * logic; this file is the render shell + selection/close/dialog glue.
 */

import React, { useCallback, useState, type Dispatch } from "react";
import { useCapabilities } from "./canvas-store";
import { ChatPanelBody } from "@/features/chat/components/chat-panel";
import { ConnectionPanelBody } from "./panels/connection-panel";
import { EntryPanelBody } from "./panels/entry-panel";
import { BrowsePanelBody } from "./panels/browse/browse-panel";
import { ClusterBrainPanel } from "./panels/cluster-brain/cluster-brain-panel";
import { KnowledgePanelBody } from "./panels/knowledge/knowledge-panel";
import { SkillsPanelBody } from "./panels/skills/skills-panel";
import { KnowledgeBasePanelBody } from "./panels/knowledge-base/knowledge-base-panel";
import { SkillPanelBody } from "./panels/skill/skill-panel";
import { useOnboardingContext } from "@/features/onboarding/components/onboarding-provider";
import { ChatExpiryBar } from "./canvas-panel-expiry";
import { useCanvasPanelDrag } from "./use-canvas-panel-drag";
import { useCanvasPanelResize } from "./use-canvas-panel-resize";
import { isPanelDeletable, type CanvasAction, type Panel } from "./types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";

interface CanvasPanelProps {
  panel: Panel;
  isSelected: boolean;
  dispatch: Dispatch<CanvasAction>;
}

function CanvasPanelInner({ panel, isSelected, dispatch }: CanvasPanelProps) {
  // Onboarding highlight — pulse glow if this panel type is the current target
  const { highlightPanelType } = useOnboardingContext();
  const isHighlighted = highlightPanelType === panel.type;

  // Viewer capabilities. On the main /canvas these are always true; on
  // the shared cluster viewer non-owners get canMove=false / canDelete=false.
  const capabilities = useCapabilities();

  // ── Drag logic ───────────────────────────────────────────────────
  const {
    isDragging,
    handleRootPointerDown,
    handleRootPointerMove,
    handleRootPointerUp,
  } = useCanvasPanelDrag(panel, dispatch);

  // ── Resize logic (browse panels only) ────────────────────────────
  const {
    isResizing,
    handleEdgePointerDown,
    handleEdgePointerMove,
    handleEdgePointerUp,
  } = useCanvasPanelResize(panel, dispatch);

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
              : panel.type === "knowledge"
                ? "Knowledge Bases"
                : panel.type === "skills"
                  ? "Skills"
                  : panel.type === "knowledge-base"
                    ? `KB · ${panel.name}`
                    : panel.type === "skill"
                      ? `Skill · ${panel.name}`
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
        {panel.type === "knowledge" && <KnowledgePanelBody panel={panel} />}
        {panel.type === "skills" && <SkillsPanelBody panel={panel} />}
        {panel.type === "knowledge-base" && <KnowledgeBasePanelBody panel={panel} />}
        {panel.type === "skill" && <SkillPanelBody panel={panel} />}
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

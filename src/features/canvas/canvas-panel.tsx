"use client";

/**
 * CanvasPanel — generic draggable wrapper for any panel type.
 *
 * Provides:
 *  - World-coordinate positioning (absolute left/top)
 *  - Liquid-glass chrome (matches the fixed input bar style)
 *  - Header with drag handle, title, and close button
 *  - Routes the panel.type to the correct body component
 *
 * Drag + resize are handled by the sibling hooks `use-canvas-panel-drag`
 * and `use-canvas-panel-resize`. See those files for the interactive
 * logic; this file is the render shell + selection/close/dialog glue.
 */

import React, { useCallback, type Dispatch } from "react";
import { useCapabilities } from "./canvas-store";
import { ConnectionPanelBody } from "./panels/connection-panel";
import { KnowledgePanelBody } from "./panels/knowledge/knowledge-panel";
import { SkillsPanelBody } from "./panels/skills/skills-panel";
import { KnowledgeBasePanelBody } from "./panels/knowledge-base/knowledge-base-panel";
import { SkillPanelBody } from "./panels/skill/skill-panel";
import { ArtifactPanelBody } from "./panels/artifact/artifact-panel";
import { WorkflowPanelBody } from "./panels/workflow/workflow-panel";
import { NodePanelBody } from "./panels/node/node-panel";
import { useCanvasPanelDrag } from "./use-canvas-panel-drag";
import { useCanvasPanelResize } from "./use-canvas-panel-resize";
import { isPanelDeletable, isPanelResizable, type CanvasAction, type Panel } from "./types";

interface CanvasPanelProps {
  panel: Panel;
  isSelected: boolean;
  dispatch: Dispatch<CanvasAction>;
}

function CanvasPanelInner({ panel, isSelected, dispatch }: CanvasPanelProps) {
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

  // ── Resize logic (browse + individual knowledge-base / skill) ─────
  const {
    isResizing,
    handleEdgePointerDown,
    handleEdgePointerMove,
    handleEdgePointerUp,
  } = useCanvasPanelResize(panel, dispatch);

  const handleClose = useCallback(() => {
    dispatch({ type: "CLOSE_PANEL", id: panel.id });
  }, [dispatch, panel]);

  const deletable = isPanelDeletable(panel) && capabilities.canDelete;
  const headerTitle =
    panel.type === "connection"
      ? "API & MCP Connection"
      : panel.type === "knowledge"
        ? "Knowledge Bases"
        : panel.type === "skills"
          ? "Skills"
          : panel.type === "knowledge-base"
            ? `Knowledge · ${panel.name}`
            : panel.type === "skill"
              ? `Skill · ${panel.name}`
              : panel.type === "artifact"
                ? `Artifact · ${panel.title}`
                : panel.type === "workflow"
                  ? "Workflow"
                  : panel.type === "node"
                    ? `Node${panel.title ? ` · ${panel.title}` : ""}`
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
        "relative rounded-2xl overflow-hidden bg-[var(--panel-surface)] border border-border-default flex flex-col select-text transition-[box-shadow] duration-150 " +
        (isSelected
          ? "shadow-[0_0_0_2px_var(--surface-cta),var(--shadow-panel)] !border-[var(--surface-cta)]"
          : "shadow-[var(--shadow-panel)]")
      }
    >
      {/* Top specular highlight — same shine as the fixed input bar. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px z-10"
        style={{ background: "var(--shine-top-gradient)" }}
      />

      {/* Header — dedicated drag handle. Marked with `data-drag-handle` so
          the root pointer-down handler always treats this region as a drag
          zone, even over the title text. Inline `cursor: grab` overrides
          the `[data-panel-id] span { cursor: text }` rule that would
          otherwise apply to the title span. `select-none` keeps the title
          from being selectable — the header is for dragging, not reading. */}
      <div
        data-drag-handle
        style={{
          cursor: isDragging ? "grabbing" : "grab",
          background: "var(--panel-header-surface)",
          borderColor: "var(--panel-header-border)",
        }}
        className="shrink-0 flex items-center gap-2 px-4 h-10 border-b select-none"
      >
        {/* Drag indicator dots */}
        <div
          className="flex flex-col gap-[2px] shrink-0 mr-1"
          aria-hidden
        >
          <div className="flex gap-[2px]">
            <span className="w-[3px] h-[3px] rounded-none bg-white/50" />
            <span className="w-[3px] h-[3px] rounded-none bg-white/50" />
          </div>
          <div className="flex gap-[2px]">
            <span className="w-[3px] h-[3px] rounded-none bg-white/50" />
            <span className="w-[3px] h-[3px] rounded-none bg-white/50" />
          </div>
          <div className="flex gap-[2px]">
            <span className="w-[3px] h-[3px] rounded-none bg-white/50" />
            <span className="w-[3px] h-[3px] rounded-none bg-white/50" />
          </div>
        </div>

        <span
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
          className="font-mono text-[10px] uppercase tracking-wide text-[var(--panel-header-text)] truncate flex-1"
        >
          {headerTitle}
        </span>

        {deletable ? (
          <button
            onClick={handleClose}
            aria-label="Close panel"
            className="w-6 h-6 flex items-center justify-center rounded-[3px] text-white/70 hover:text-white hover:bg-white/15 border border-transparent hover:border-white/25 transition-colors"
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
            className="w-6 h-6 flex items-center justify-center text-white/70"
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

      {/* Body — routes by panel type */}
      <div className="flex-1 min-h-0 flex flex-col">
        {panel.type === "connection" && <ConnectionPanelBody />}
        {panel.type === "knowledge" && <KnowledgePanelBody panel={panel} />}
        {panel.type === "skills" && <SkillsPanelBody panel={panel} />}
        {panel.type === "knowledge-base" && <KnowledgeBasePanelBody panel={panel} />}
        {panel.type === "skill" && <SkillPanelBody panel={panel} />}
        {panel.type === "artifact" && <ArtifactPanelBody panel={panel} dispatch={dispatch} />}
        {panel.type === "workflow" && <WorkflowPanelBody panel={panel} />}
        {panel.type === "node" && <NodePanelBody panel={panel} />}
      </div>

      {/* Resize edges & corners — browse + individual knowledge-base / skill */}
      {isPanelResizable(panel) && (
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

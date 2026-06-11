"use client";

/**
 * CanvasHistoryBar — the canvas's bottom control bar. Currently houses
 * back/forward (undo/redo) over the structural history (panel + edge
 * changes; see the reducer's history wrapper); designed to grow more
 * controls later.
 *
 * Rendered inside the canvas viewport, pinned bottom-center. Pointer
 * events are stopped so pressing a button never starts a marquee.
 */

import { Redo2, Undo2 } from "lucide-react";
import { useCanvas, useCapabilities } from "./canvas-store";

export function CanvasHistoryBar() {
  const { state, dispatch } = useCanvas();
  const { canMove } = useCapabilities();
  // Read-only canvases (shared viewer) have nothing to revert.
  if (!canMove) return null;

  const canUndo = state.history.past.length > 0;
  const canRedo = state.history.future.length > 0;

  return (
    <div
      className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 select-none"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 rounded-[10px] border border-border-subtle bg-bg-inset p-1 shadow-[0_6px_24px_rgba(0,0,0,0.14)]">
        <HistoryButton
          label="Undo (⌘Z)"
          disabled={!canUndo}
          onClick={() => dispatch({ type: "UNDO" })}
        >
          <Undo2 size={14} strokeWidth={1.8} />
        </HistoryButton>
        <HistoryButton
          label="Redo (⇧⌘Z)"
          disabled={!canRedo}
          onClick={() => dispatch({ type: "REDO" })}
        >
          <Redo2 size={14} strokeWidth={1.8} />
        </HistoryButton>
      </div>
    </div>
  );
}

function HistoryButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary cursor-pointer disabled:cursor-default"
    >
      {children}
    </button>
  );
}

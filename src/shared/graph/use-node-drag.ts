"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  AUTOSCROLL_MARGIN,
  DEFAULT_GRID,
  DEFAULT_THRESHOLD,
  autoScrollDelta,
  exceededThreshold,
  snapPoint,
} from "./drag-math";
import type { NodeLayout, Point } from "./types";

/** Live drag offset in world space (dx/dy from the node's start pos). */
export interface NodeDragState {
  nodeId: string;
  dx: number;
  dy: number;
}

export interface UseNodeDragParams {
  /** Effective positions (id → {x,y,width}) — the drag-start basis. */
  positions: Record<string, NodeLayout>;
  /** Fires ONCE on release with the node's final (snapped) position. */
  onDragEnd: (nodeId: string, position: Point) => void;
  /** Scroll container (world viewport) — enables edge auto-scroll. */
  scrollRef?: RefObject<HTMLElement | null>;
  /** Snap grid in px (default 8; 0 disables). */
  grid?: number;
  /** Movement before a press becomes a drag (default 4px). */
  threshold?: number;
  /** When true, pointerdown is ignored (viewers / read-only). */
  disabled?: boolean;
}

export interface UseNodeDrag {
  /** Null unless a drag is in progress (past the threshold). */
  drag: NodeDragState | null;
  /** ⚠ Guard a node's onClick with this to swallow the post-drag click. */
  isDragging: boolean;
  /** Attach to a node card's `onPointerDown`. */
  onNodePointerDown: (nodeId: string, e: ReactPointerEvent) => void;
}

interface Session {
  nodeId: string;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
  startX: number;
  startY: number;
  lastClientX: number;
  lastClientY: number;
  moved: boolean;
  captureEl: Element | null;
  pointerId: number;
}

/**
 * Pointer dragging for absolutely-positioned node cards in a scrollable
 * world. Press → drag only past a threshold (clicks still select); then
 * pointer capture, world delta (accounting for mid-drag scroll), edge
 * auto-scroll, grid snap, Escape cancels. `onDragEnd` fires exactly once on
 * release — persistence debounced upstream (`useGraphPositions`).
 */
export function useNodeDrag({
  positions,
  onDragEnd,
  scrollRef,
  grid = DEFAULT_GRID,
  threshold = DEFAULT_THRESHOLD,
  disabled = false,
}: UseNodeDragParams): UseNodeDrag {
  const [drag, setDrag] = useState<NodeDragState | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const rafRef = useRef<number | null>(null);

  // ⚠ Latest props via refs: window listeners bound for one drag session
  // would otherwise see stale positions / callbacks.
  const onDragEndRef = useRef(onDragEnd);
  const positionsRef = useRef(positions);
  const gridRef = useRef(grid);
  onDragEndRef.current = onDragEnd;
  positionsRef.current = positions;
  gridRef.current = grid;

  const stopAutoScroll = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const applyDelta = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const container = scrollRef?.current ?? null;
    const scrollDx = container ? container.scrollLeft - s.startScrollLeft : 0;
    const scrollDy = container ? container.scrollTop - s.startScrollTop : 0;
    const dx = s.lastClientX - s.startClientX + scrollDx;
    const dy = s.lastClientY - s.startClientY + scrollDy;
    if (!s.moved && exceededThreshold(dx, dy, threshold)) s.moved = true;
    if (s.moved) setDrag({ nodeId: s.nodeId, dx, dy });
  }, [scrollRef, threshold]);

  const tickAutoScroll = useCallback(() => {
    const s = sessionRef.current;
    const container = scrollRef?.current ?? null;
    if (!s || !s.moved || !container) {
      rafRef.current = null;
      return;
    }
    const rect = container.getBoundingClientRect();
    const delta = autoScrollDelta(
      { x: s.lastClientX, y: s.lastClientY },
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      AUTOSCROLL_MARGIN
    );
    if (delta.x !== 0 || delta.y !== 0) {
      container.scrollLeft += delta.x;
      container.scrollTop += delta.y;
      applyDelta();
    }
    rafRef.current = requestAnimationFrame(tickAutoScroll);
  }, [scrollRef, applyDelta]);

  const finish = useCallback(
    (commit: boolean) => {
      const s = sessionRef.current;
      sessionRef.current = null;
      stopAutoScroll();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      if (s?.captureEl && s.captureEl.hasPointerCapture?.(s.pointerId)) {
        s.captureEl.releasePointerCapture(s.pointerId);
      }
      if (s && commit && s.moved) {
        const container = scrollRef?.current ?? null;
        const scrollDx = container ? container.scrollLeft - s.startScrollLeft : 0;
        const scrollDy = container ? container.scrollTop - s.startScrollTop : 0;
        const next = snapPoint(
          {
            x: Math.max(0, s.startX + (s.lastClientX - s.startClientX) + scrollDx),
            y: Math.max(0, s.startY + (s.lastClientY - s.startClientY) + scrollDy),
          },
          gridRef.current
        );
        onDragEndRef.current(s.nodeId, next);
      }
      setDrag(null);
    },
    // onPointerMove/Up/KeyDown are stable (defined below via refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scrollRef, stopAutoScroll]
  );

  // ⚠ Stable handler identities in refs so add/remove pair up across renders.
  const handlersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: PointerEvent) => void;
    key: (e: KeyboardEvent) => void;
  }>({
    move: () => {},
    up: () => {},
    cancel: () => {},
    key: () => {},
  });

  const onPointerMove = useCallback((e: PointerEvent) => handlersRef.current.move(e), []);
  const onPointerUp = useCallback((e: PointerEvent) => handlersRef.current.up(e), []);
  const onPointerCancel = useCallback((e: PointerEvent) => handlersRef.current.cancel(e), []);
  const onKeyDown = useCallback((e: KeyboardEvent) => handlersRef.current.key(e), []);

  handlersRef.current.move = (e: PointerEvent) => {
    const s = sessionRef.current;
    if (!s) return;
    s.lastClientX = e.clientX;
    s.lastClientY = e.clientY;
    applyDelta();
    if (s.moved && scrollRef?.current && rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tickAutoScroll);
    }
    if (s.moved) e.preventDefault();
  };
  handlersRef.current.up = () => finish(true);
  // Cancelled pointer (OS gesture, touch interruption) → abandon like Escape;
  // never commit a partial move.
  handlersRef.current.cancel = () => finish(false);
  handlersRef.current.key = (e: KeyboardEvent) => {
    if (e.key === "Escape") finish(false);
  };

  const onNodePointerDown = useCallback(
    (nodeId: string, e: ReactPointerEvent) => {
      if (disabled || e.button !== 0) return;
      const pos = positionsRef.current[nodeId];
      if (!pos) return;
      const container = scrollRef?.current ?? null;
      const el = e.currentTarget as Element;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Best-effort; window listeners still track the drag.
      }
      sessionRef.current = {
        nodeId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startScrollLeft: container?.scrollLeft ?? 0,
        startScrollTop: container?.scrollTop ?? 0,
        startX: pos.x,
        startY: pos.y,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
        moved: false,
        captureEl: el,
        pointerId: e.pointerId,
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      window.addEventListener("keydown", onKeyDown);
    },
    [disabled, scrollRef, onPointerMove, onPointerUp, onPointerCancel, onKeyDown]
  );

  useEffect(
    () => () => {
      stopAutoScroll();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
    },
    [stopAutoScroll, onPointerMove, onPointerUp, onPointerCancel, onKeyDown]
  );

  return { drag, isDragging: drag !== null, onNodePointerDown };
}

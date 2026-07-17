"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { autoScrollDelta, type NodeRect, type Point } from "@/shared/graph";
import { clientToWorld, hitTestNode, portAnchor, type PortSide } from "../graph/ports";

/** Live state of an in-progress connector drag. */
export interface ConnectDragState {
  /** The card the connector is being pulled FROM. */
  sourceId: string;
  sourceSide: PortSide;
  /** World-space anchor of the source port (the preview's fixed end). */
  origin: Point;
  /** World-space pointer position (the preview's moving end). */
  pointer: Point;
  /** The card currently under the pointer (a valid drop target), or null. */
  targetId: string | null;
}

export interface UseConnectDragParams {
  /** Live node rects (world space) — the drop hit-test surface. */
  rects: Record<string, NodeRect>;
  /** The scrollable substrate viewport (maps client → world coords). */
  scrollRef: RefObject<HTMLElement | null>;
  /** Fires on release over a valid target: (sourceId, targetId, dropClient). */
  onConnect: (sourceId: string, targetId: string, dropClient: Point) => void;
  /** When true, ports never start a drag (viewers / read-only). */
  disabled?: boolean;
}

export interface UseConnectDrag {
  /** Null unless a connector drag is in progress. */
  connect: ConnectDragState | null;
  isConnecting: boolean;
  /** Attach to a port's `onPointerDown` (call after stopPropagation). */
  onPortPointerDown: (nodeId: string, side: PortSide, e: ReactPointerEvent) => void;
}

interface Session {
  sourceId: string;
  sourceSide: PortSide;
  origin: Point;
  captureEl: Element | null;
  pointerId: number;
  targetId: string | null;
  lastClientX: number;
  lastClientY: number;
  /** Aborts this gesture's window listeners in one call. */
  controller: AbortController;
}

/**
 * Pointer-based drag-to-connect for the workflow graph. A press on a card's
 * output port starts a rubber-band connector; the gesture captures the
 * pointer, tracks the world-space pointer position (accounting for the
 * substrate's scroll), hit-tests the card under the pointer as the live drop
 * target, and on release over a target fires `onConnect` once (Escape or a
 * drop on empty substrate cancels). Target detection is geometric — pointer
 * capture routes every move to the source port, so the cards never see a DOM
 * hover. Coexists with `useNodeDrag` by construction: node-drag starts on the
 * card body, connect-drag on a port that stops propagation. Touch-safe via
 * pointer events; each gesture's listeners are torn down with an
 * AbortController.
 */
export function useConnectDrag({
  rects,
  scrollRef,
  onConnect,
  disabled = false,
}: UseConnectDragParams): UseConnectDrag {
  const [connect, setConnect] = useState<ConnectDragState | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const rafRef = useRef<number | null>(null);

  // Latest props via refs so the stable window listeners never read a stale
  // rect map / callback (synced in an effect, not during render).
  const rectsRef = useRef(rects);
  const onConnectRef = useRef(onConnect);
  useEffect(() => {
    rectsRef.current = rects;
    onConnectRef.current = onConnect;
  });

  const stopAutoScroll = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Recompute the world-space pointer + live drop target from the last client
  // position. Called on pointer move AND after each auto-scroll step — scroll
  // shifts the world under a stationary pointer, so re-hit-testing here is
  // what makes an off-screen target reachable by dragging to the edge.
  const recompute = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const container = scrollRef.current;
    const rect = container?.getBoundingClientRect();
    const pointer = clientToWorld(s.lastClientX, s.lastClientY, {
      left: rect?.left ?? 0,
      top: rect?.top ?? 0,
      scrollLeft: container?.scrollLeft ?? 0,
      scrollTop: container?.scrollTop ?? 0,
    });
    const targetId = hitTestNode(pointer, rectsRef.current, s.sourceId);
    s.targetId = targetId;
    setConnect({
      sourceId: s.sourceId,
      sourceSide: s.sourceSide,
      origin: s.origin,
      pointer,
      targetId,
    });
  }, [scrollRef]);

  // The rAF loop lives behind a ref so neither it nor `handleMove` takes a
  // dependency on it (a self-referencing useCallback trips the hooks linter).
  // Synced in an effect (never during render) and closes over the latest
  // `recompute`; only ever invoked from requestAnimationFrame, after mount.
  const tickRef = useRef<() => void>(() => {});
  useEffect(() => {
    tickRef.current = () => {
      const s = sessionRef.current;
      const container = scrollRef.current;
      if (!s || !container) {
        rafRef.current = null;
        return;
      }
      const rect = container.getBoundingClientRect();
      const delta = autoScrollDelta({ x: s.lastClientX, y: s.lastClientY }, rect);
      if (delta.x !== 0 || delta.y !== 0) {
        container.scrollLeft += delta.x;
        container.scrollTop += delta.y;
        recompute();
      }
      rafRef.current = requestAnimationFrame(() => tickRef.current());
    };
  });

  const finish = useCallback(
    (commit: boolean) => {
      const s = sessionRef.current;
      sessionRef.current = null;
      stopAutoScroll();
      if (!s) return;
      s.controller.abort();
      if (s.captureEl && s.captureEl.hasPointerCapture?.(s.pointerId)) {
        s.captureEl.releasePointerCapture(s.pointerId);
      }
      if (commit && s.targetId && s.targetId !== s.sourceId) {
        onConnectRef.current(s.sourceId, s.targetId, { x: s.lastClientX, y: s.lastClientY });
      }
      setConnect(null);
    },
    [stopAutoScroll]
  );

  const handleMove = useCallback(
    (e: PointerEvent) => {
      const s = sessionRef.current;
      if (!s) return;
      s.lastClientX = e.clientX;
      s.lastClientY = e.clientY;
      recompute();
      if (scrollRef.current && rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => tickRef.current());
      }
      e.preventDefault();
    },
    [recompute, scrollRef]
  );

  const handleUp = useCallback(() => finish(true), [finish]);
  const handleCancel = useCallback(() => finish(false), [finish]);
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    },
    [finish]
  );

  const onPortPointerDown = useCallback(
    (nodeId: string, side: PortSide, e: ReactPointerEvent) => {
      if (disabled || e.button !== 0) return;
      const rect = rectsRef.current[nodeId];
      if (!rect) return;
      const el = e.currentTarget as Element;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Capture is best-effort; window listeners still track the gesture.
      }
      const origin = portAnchor(rect, side);
      const controller = new AbortController();
      sessionRef.current = {
        sourceId: nodeId,
        sourceSide: side,
        origin,
        captureEl: el,
        pointerId: e.pointerId,
        targetId: null,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
        controller,
      };
      setConnect({ sourceId: nodeId, sourceSide: side, origin, pointer: origin, targetId: null });
      const { signal } = controller;
      window.addEventListener("pointermove", handleMove, { signal });
      window.addEventListener("pointerup", handleUp, { signal });
      window.addEventListener("pointercancel", handleCancel, { signal });
      window.addEventListener("keydown", handleKey, { signal });
    },
    [disabled, handleMove, handleUp, handleCancel, handleKey]
  );

  useEffect(
    () => () => {
      stopAutoScroll();
      sessionRef.current?.controller.abort();
    },
    [stopAutoScroll]
  );

  return { connect, isConnecting: connect !== null, onPortPointerDown };
}

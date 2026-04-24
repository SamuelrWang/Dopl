"use client";

/**
 * Canvas — the infinite pannable, zoomable viewport.
 *
 * Layout:
 *   - Outer div (viewport): position relative, overflow hidden, fills its parent.
 *   - Inner div (world): transformed by `translate(x, y) scale(zoom)` with
 *     transform-origin set to 0 0. Each panel renders inside this div as an
 *     absolutely positioned child at its world coordinates. Because the
 *     whole world div is scaled, every descendant (any future panel type)
 *     gets zoom for free — no per-component math.
 *
 * Drag interactions:
 *   - Pointerdown on background → begin a MARQUEE selection box. Dragging
 *     updates `state.selectedPanelIds` live based on which panels the box
 *     intersects. Releasing without movement clears selection.
 *   - Two-finger trackpad swipe (wheel event, no ctrlKey) → pan camera.
 *   - Panel drags originate from CanvasPanel, whose pointerdown
 *     stopPropagations so nothing here fires inside a panel.
 *
 * Zoom:
 *   - Trackpad pinch fires `wheel` events with `ctrlKey: true` on every major
 *     browser. We intercept those, compute a new zoom, and dispatch a
 *     ZOOM_AT action that anchors the world point under the cursor.
 *   - React's synthetic onWheel is passive in React 17+, so preventDefault
 *     doesn't work there. We attach a native listener via useEffect with
 *     { passive: false }.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCanvas } from "./canvas-store";
import { MAX_ZOOM, MIN_ZOOM, computePanelsBounds, type Cluster, type Panel } from "./types";
import { CanvasMinimap } from "./canvas-minimap";
import { clusterBounds } from "./clusters/cluster-geometry";
import { SelectionMenu } from "./selection/selection-menu";
import { useEdgeScroll } from "./use-edge-scroll";
import {
  applyCameraDirect,
  MARQUEE_CLICK_THRESHOLD_PX,
  WorldContents,
  findClusterAtPoint,
  boxIntersectsPanel,
  getGridCellSize,
  type ClusterDragState,
  type MarqueeState,
} from "./canvas-parts";

// Re-export for external consumers (e.g. canvas-minimap).
export { applyCameraDirect };

interface CanvasProps {
  /**
   * Show the bird's-eye minimap in the bottom-right corner. Defaults to
   * true. The published cluster viewer turns it off — visitors there
   * don't navigate large workspaces, so the minimap is just chrome.
   */
  showMinimap?: boolean;
}

export function Canvas({ showMinimap = true }: CanvasProps = {}) {
  const { state, dispatch } = useCanvas();
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  // Keep ref in sync with state so handlers always see latest value.
  marqueeRef.current = marquee;

  // Track viewport dimensions for the minimap.
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setVpSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ONE-TIME: center the camera on the panels bounding box on mount.
  // Also resets residual scroll from the old overflow:hidden bug.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollLeft = 0;
    el.scrollTop = 0;

    const bounds = computePanelsBounds(state.panels);
    if (!bounds) return; // no panels — keep default camera

    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const zoom = state.camera.zoom;
    dispatch({
      type: "SET_CAMERA",
      camera: {
        x: vw / 2 - bounds.centerX * zoom,
        y: vh / 2 - bounds.centerY * zoom,
        zoom,
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // Cache grid cell sizes so we use plain pixel math (no CSS calc()).
  const gridCellRef = useRef<{ cx: number; cy: number }>({ cx: 160, cy: 160 });
  useEffect(() => {
    gridCellRef.current = getGridCellSize();
    const onResize = () => { gridCellRef.current = getGridCellSize(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // During zoom/pan gestures we mutate the DOM directly and defer the React
  // state sync until the gesture pauses. This avoids a full re-render on
  // every wheel tick (~60/sec) which is the main source of zoom jank.
  const gestureFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCameraRef = useRef<{ x: number; y: number; zoom: number } | null>(null);

  // Cluster drag lives in a ref because we don't need to re-render on
  // every pointermove (the MOVE_PANELS dispatch does that work). Set
  // when pointerdown hits empty cluster space, cleared on pointerup.
  const clusterDragRef = useRef<ClusterDragState | null>(null);

  // Mirror the latest camera into a ref so the native wheel listener (below)
  // can read it without re-attaching on every camera change.
  // IMPORTANT: skip the sync while a gesture is in progress — the refs are
  // authoritative during gestures, and state.camera is stale until the
  // debounce flush. Without this guard, a concurrent React re-render (e.g.
  // panel content update) would overwrite the ref with the pre-gesture camera.
  const cameraRef = useRef(state.camera);
  useEffect(() => {
    if (!pendingCameraRef.current) {
      cameraRef.current = state.camera;
    }
  }, [state.camera]);

  // The world div's transform is controlled entirely by this effect (and by
  // applyCameraDirect during gestures). The JSX does NOT set `transform` —
  // this prevents React re-renders from ever overwriting the gesture camera
  // with stale state.camera values.
  useLayoutEffect(() => {
    if (gestureFlushRef.current) return;
    const worldEl = worldRef.current;
    const el = viewportRef.current;
    if (worldEl && el) {
      // Outside gestures, state.camera is authoritative — read it
      // directly. cameraRef lags by one render (its sync runs in a
      // useEffect, after this layout effect), so using it here would
      // apply the pre-dispatch transform for external SET_CAMERA calls.
      const cam = pendingCameraRef.current ?? state.camera;
      applyCameraDirect(el, worldEl, cam, gridCellRef.current);
    }
  }, [state.camera]);

  // Same trick for the live panels list — the marquee handler needs to
  // read the current panel positions on every pointermove without being
  // re-created on every state change.
  const panelsRef = useRef(state.panels);
  useEffect(() => {
    panelsRef.current = state.panels;
  }, [state.panels]);

  // Cluster list ref — used by the pointerdown hit-test without
  // re-creating the callback on every cluster change.
  const clustersRef = useRef(state.clusters);
  useEffect(() => {
    clustersRef.current = state.clusters;
  }, [state.clusters]);

  // Clear the selection menu when selection drops below 2 panels.
  useEffect(() => {
    if (state.selectedPanelIds.length < 2) setCursorPos(null);
  }, [state.selectedPanelIds]);

  // ── Edge-scroll: auto-pan when cursor hits window edge ────────────
  useEdgeScroll({
    viewportRef,
    worldRef,
    cameraRef,
    pendingCameraRef,
    gestureFlushRef,
    gridCellRef,
    dispatch,
  });

  // ── Background pointerdown (cluster drag OR marquee) ──────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only primary clicks. Panel clicks stopPropagation so anything
      // reaching this handler originated on the background.
      if (e.button !== 0) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const vx = e.clientX - rect.left;
      const vy = e.clientY - rect.top;

      // Convert to world coords for cluster hit testing.
      const camera = cameraRef.current;
      const worldX = (vx - camera.x) / camera.zoom;
      const worldY = (vy - camera.y) / camera.zoom;

      // 1. Cluster hit test — if the pointer is inside a cluster's empty
      //    area, start a cluster drag that moves every member together.
      //    Shift+click on an empty cluster area additively selects the
      //    members WITHOUT starting a drag (so the user can combine
      //    clusters into a single selection).
      const hitCluster = findClusterAtPoint(
        clustersRef.current,
        panelsRef.current,
        { x: worldX, y: worldY }
      );
      if (hitCluster) {
        if (e.shiftKey) {
          // Additive: union the cluster members into the existing selection
          // and bail — no drag.
          const merged = Array.from(
            new Set([...state.selectedPanelIds, ...hitCluster.panelIds])
          );
          dispatch({ type: "SET_SELECTION", panelIds: merged });
          return;
        }

        viewport.setPointerCapture(e.pointerId);

        // Capture starting positions for every cluster member so the
        // move handler can apply a rigid delta.
        const memberPositions = panelsRef.current
          .filter((p) => hitCluster.panelIds.includes(p.id))
          .map((p) => ({ id: p.id, x: p.x, y: p.y }));

        clusterDragRef.current = {
          clusterId: hitCluster.id,
          mouseX: e.clientX,
          mouseY: e.clientY,
          panels: memberPositions,
        };

        // Select the cluster members while dragging so the UI shows
        // consistent "what you're moving".
        dispatch({ type: "SET_SELECTION", panelIds: hitCluster.panelIds });
        return;
      }

      // 2. No cluster hit — fall through to marquee selection.
      viewport.setPointerCapture(e.pointerId);
      setMarquee({
        startX: vx,
        startY: vy,
        endX: vx,
        endY: vy,
        baseSelection: e.shiftKey ? state.selectedPanelIds : [],
        additive: e.shiftKey,
      });
    },
    [state.selectedPanelIds, dispatch]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Cluster drag takes precedence — if one is active we route all
      // movement there and skip marquee logic entirely.
      const clusterDrag = clusterDragRef.current;
      if (clusterDrag) {
        const zoom = cameraRef.current.zoom;
        const dx = (e.clientX - clusterDrag.mouseX) / zoom;
        const dy = (e.clientY - clusterDrag.mouseY) / zoom;
        dispatch({
          type: "MOVE_PANELS",
          moves: clusterDrag.panels.map((p) => ({
            id: p.id,
            x: p.x + dx,
            y: p.y + dy,
          })),
        });
        return;
      }

      // Read marquee from ref to avoid stale closure — the useCallback
      // deps intentionally exclude marquee state for performance, so the
      // ref is the only reliable source during a drag gesture.
      const currentMarquee = marqueeRef.current;
      if (!currentMarquee) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const vx = e.clientX - rect.left;
      const vy = e.clientY - rect.top;

      setMarquee((prev) => (prev ? { ...prev, endX: vx, endY: vy } : null));

      // Normalise the box corners so x1/y1 is top-left regardless of
      // which direction the user dragged.
      const box = {
        x1: Math.min(currentMarquee.startX, vx),
        y1: Math.min(currentMarquee.startY, vy),
        x2: Math.max(currentMarquee.startX, vx),
        y2: Math.max(currentMarquee.startY, vy),
      };

      // Instead of trusting camera refs (which can be stale after zoom/pan),
      // hit-test by reading each panel's actual screen position from the DOM.
      const hitIds: string[] = [];
      for (const p of panelsRef.current) {
        const el = document.querySelector(`[data-panel-id="${p.id}"]`) as HTMLElement | null;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        // AABB intersection in screen space
        if (box.x1 < r.right && box.x2 > r.left && box.y1 < r.bottom && box.y2 > r.top) {
          hitIds.push(p.id);
        }
      }

      // Additive (shift) marquee keeps the base selection and adds the
      // hits; non-additive replaces outright.
      const nextSelection = currentMarquee.additive
        ? Array.from(new Set([...currentMarquee.baseSelection, ...hitIds]))
        : hitIds;

      dispatch({ type: "SET_SELECTION", panelIds: nextSelection });
    },
    [dispatch]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (viewport && viewport.hasPointerCapture(e.pointerId)) {
        viewport.releasePointerCapture(e.pointerId);
      }

      // Cluster drag release — clear the drag ref, keep the selection
      // (which already reflects the cluster's members).
      if (clusterDragRef.current) {
        clusterDragRef.current = null;
        return;
      }

      const currentMarquee = marqueeRef.current;
      if (!currentMarquee) return;

      const dx = Math.abs(currentMarquee.endX - currentMarquee.startX);
      const dy = Math.abs(currentMarquee.endY - currentMarquee.startY);
      // Tiny movement = treat as a plain click on the background, which
      // clears the selection (unless shift was held, in which case the
      // user probably meant to preserve their existing set).
      if (
        dx < MARQUEE_CLICK_THRESHOLD_PX &&
        dy < MARQUEE_CLICK_THRESHOLD_PX &&
        !currentMarquee.additive
      ) {
        dispatch({ type: "SET_SELECTION", panelIds: [] });
        setCursorPos(null);
      } else {
        // Marquee ended — show selection menu at cursor if 2+ panels selected.
        setCursorPos({ x: e.clientX, y: e.clientY });
      }
      setMarquee(null);
    },
    [dispatch]
  );

  // ── Zoom (trackpad pinch) ─────────────────────────────────────────
  // Attached once via native addEventListener so we can preventDefault.
  // Reads the latest camera from cameraRef so this effect doesn't need to
  // re-attach on every state change.
  //
  // Gesture locking: wheel events during a two-finger swipe fire in
  // rapid succession (~60Hz). On the FIRST event of a gesture we
  // decide whether this swipe is a canvas pan or a panel scroll, then
  // we lock that mode for the duration of the gesture. Any follow-up
  // events within `GESTURE_TIMEOUT_MS` inherit the locked mode —
  // meaning mid-swipe cursor movement across a panel boundary can't
  // switch pan to scroll (or vice versa) until the user stops swiping.
  const wheelGestureRef = useRef<{
    lastTime: number;
    mode: "pan" | "scroll" | "zoom";
  } | null>(null);
  const GESTURE_TIMEOUT_MS = 100;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;

      // ── Two-finger swipe ─────────────────────────────────────────
      if (!e.ctrlKey) {
        const now = performance.now();
        const existing = wheelGestureRef.current;
        const inGesture =
          existing !== null && now - existing.lastTime < GESTURE_TIMEOUT_MS;

        if (inGesture) {
          if (existing.mode === "zoom") {
            e.preventDefault();
            wheelGestureRef.current = { lastTime: now, mode: "zoom" };
            return;
          }
          if (existing.mode === "pan") {
            e.preventDefault();
            // Direct DOM mutation for pan — avoid React re-render per tick
            const cam = pendingCameraRef.current ?? cameraRef.current;
            const nextCam = {
              x: cam.x - e.deltaX,
              y: cam.y - e.deltaY,
              zoom: cam.zoom,
            };
            pendingCameraRef.current = nextCam;
            cameraRef.current = nextCam;
            const worldEl = worldRef.current;
            if (worldEl) applyCameraDirect(el, worldEl, nextCam, gridCellRef.current);
            if (gestureFlushRef.current) clearTimeout(gestureFlushRef.current);
            gestureFlushRef.current = setTimeout(() => {
              const p = pendingCameraRef.current;
              if (p) {
                dispatch({ type: "SET_CAMERA", camera: p });
                pendingCameraRef.current = null;
              }
              gestureFlushRef.current = null;
            }, 80);
          }
          // `scroll` mode: do nothing — let the browser scroll the
          // panel natively (same as a fresh scroll-mode event would).
          wheelGestureRef.current = { lastTime: now, mode: existing.mode };
          return;
        }

        // ── Fresh gesture — decide the lock mode ───────────────────
        // Walk up from the event target to our viewport. If any ancestor
        // has an auto/scroll overflow in the direction of the delta AND
        // has overflowing content, lock this gesture as "scroll" and
        // let the browser do its thing.
        if (target && target !== el) {
          let node: HTMLElement | null = target;
          while (node && node !== el) {
            const style = window.getComputedStyle(node);
            const overflowY = style.overflowY;
            const overflowX = style.overflowX;
            const canScrollY =
              (overflowY === "auto" || overflowY === "scroll") &&
              node.scrollHeight > node.clientHeight;
            const canScrollX =
              (overflowX === "auto" || overflowX === "scroll") &&
              node.scrollWidth > node.clientWidth;
            if (
              (canScrollY && Math.abs(e.deltaY) > 0) ||
              (canScrollX && Math.abs(e.deltaX) > 0)
            ) {
              wheelGestureRef.current = { lastTime: now, mode: "scroll" };
              return;
            }
            node = node.parentElement;
          }
        }

        // No scrollable ancestor — lock as "pan" and pan the canvas.
        e.preventDefault();
        {
          const cam = pendingCameraRef.current ?? cameraRef.current;
          const nextCam = {
            x: cam.x - e.deltaX,
            y: cam.y - e.deltaY,
            zoom: cam.zoom,
          };
          pendingCameraRef.current = nextCam;
          cameraRef.current = nextCam;
          const worldEl = worldRef.current;
          if (worldEl) applyCameraDirect(el, worldEl, nextCam, gridCellRef.current);
          if (gestureFlushRef.current) clearTimeout(gestureFlushRef.current);
          gestureFlushRef.current = setTimeout(() => {
            const p = pendingCameraRef.current;
            if (p) {
              dispatch({ type: "SET_CAMERA", camera: p });
              pendingCameraRef.current = null;
            }
            gestureFlushRef.current = null;
          }, 80);
        }
        wheelGestureRef.current = { lastTime: now, mode: "pan" };
        return;
      }

      // ── Pinch → anchored zoom (always, regardless of target) ─────
      e.preventDefault();
      e.stopPropagation();
      // Register pinch in the gesture ref so interleaved ctrlKey-false
      // events (translational component of the pinch) are suppressed
      // by the pan path above. Without this, pinch-to-zoom also pans.
      wheelGestureRef.current = { lastTime: performance.now(), mode: "zoom" };

      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      // Normalize deltaY: Mac trackpad pinch emits ~1-5 per event, Windows
      // precision touchpads can emit 50+. Cap to ±50 so a fast Windows
      // pinch can't blow past the zoom clamps in a single frame.
      const normalizedDelta = Math.max(-50, Math.min(50, e.deltaY));

      // Exponential step so each tick is a constant relative change.
      // factor > 1 when deltaY < 0 (pinch out → zoom in), < 1 when > 0.
      const factor = Math.exp(-normalizedDelta * 0.01);

      const cam = pendingCameraRef.current ?? cameraRef.current;
      const oldZoom = cam.zoom;
      const newZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, oldZoom * factor)
      );

      // No-op when clamped at either bound.
      if (newZoom === oldZoom) return;

      // Anchored zoom math: keep the world-point under the cursor fixed.
      const wx = (cursorX - cam.x) / oldZoom;
      const wy = (cursorY - cam.y) / oldZoom;
      const nextCam = {
        x: cursorX - wx * newZoom,
        y: cursorY - wy * newZoom,
        zoom: newZoom,
      };

      // Direct DOM mutation — no React re-render
      pendingCameraRef.current = nextCam;
      cameraRef.current = nextCam;
      const worldEl = worldRef.current;
      if (worldEl) {
        applyCameraDirect(el, worldEl, nextCam, gridCellRef.current);
      }

      // Debounce the React state sync until the gesture pauses
      if (gestureFlushRef.current) clearTimeout(gestureFlushRef.current);
      gestureFlushRef.current = setTimeout(() => {
        const pending = pendingCameraRef.current;
        if (pending) {
          dispatch({ type: "SET_CAMERA", camera: pending });
          pendingCameraRef.current = null;
        }
        gestureFlushRef.current = null;
      }, 80);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });

    // Prevent Safari's native GestureEvent from triggering browser-level
    // page zoom during trackpad pinch. Safari fires these IN ADDITION to
    // the ctrlKey wheel events we handle above, and if not prevented,
    // the browser zooms the page AND we zoom the canvas = double zoom
    // with mismatched coordinate systems.
    const preventGesture = (e: Event) => { e.preventDefault(); };
    el.addEventListener("gesturestart", preventGesture, { passive: false } as EventListenerOptions);
    el.addEventListener("gesturechange", preventGesture, { passive: false } as EventListenerOptions);
    el.addEventListener("gestureend", preventGesture, { passive: false } as EventListenerOptions);

    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("gesturestart", preventGesture);
      el.removeEventListener("gesturechange", preventGesture);
      el.removeEventListener("gestureend", preventGesture);
    };
  }, [dispatch]);

  // ── Keyboard shortcuts: Delete selected panels + Undo ──────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when user is typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement).isContentEditable) return;

      // Backspace / Delete → delete selected panels
      if (e.key === "Backspace" || e.key === "Delete") {
        if (state.selectedPanelIds.length > 0) {
          e.preventDefault();
          dispatch({ type: "DELETE_SELECTED_PANELS" });
        }
        return;
      }

      // Cmd+Z (Mac) / Ctrl+Z (Win) → undo delete
      if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO_DELETE" });
        return;
      }

      // WASD + Arrow keys → pan camera
      const PAN_STEP = 80;
      const panMap: Record<string, { dx: number; dy: number }> = {
        ArrowLeft: { dx: PAN_STEP, dy: 0 },
        ArrowRight: { dx: -PAN_STEP, dy: 0 },
        ArrowUp: { dx: 0, dy: PAN_STEP },
        ArrowDown: { dx: 0, dy: -PAN_STEP },
        a: { dx: PAN_STEP, dy: 0 },
        d: { dx: -PAN_STEP, dy: 0 },
        w: { dx: 0, dy: PAN_STEP },
        s: { dx: 0, dy: -PAN_STEP },
      };
      const pan = panMap[e.key];
      if (pan) {
        e.preventDefault();
        dispatch({ type: "PAN_CAMERA", ...pan });
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dispatch, state.selectedPanelIds]);

  const { x: camX, y: camY, zoom } = state.camera;

  // Geometry for the marquee overlay — normalised so the div always has a
  // positive size regardless of drag direction.
  const marqueeRect = marquee
    ? {
        left: Math.min(marquee.startX, marquee.endX),
        top: Math.min(marquee.startY, marquee.endY),
        width: Math.abs(marquee.endX - marquee.startX),
        height: Math.abs(marquee.endY - marquee.startY),
      }
    : null;

  return (
    <div
      ref={viewportRef}
      data-canvas-viewport
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="relative w-full h-full overflow-clip touch-none select-none"
      style={{ cursor: "default" }}
    >
      {/* World layer — scaled then translated by camera. Cluster outlines
          render BEHIND the panels so panels always appear "on top of"
          their cluster backdrop.
          transform-origin MUST be 0 0 — the browser default of 50% 50% would
          silently break the anchored-zoom math.

          IMPORTANT: use `translate3d` + `scale3d` (not the 2D variants).
          The 3D versions force the browser to promote this subtree to a
          dedicated GPU compositing layer, which is the difference between
          smooth zoom and the stutter you get when the CPU has to
          re-rasterize every panel on every wheel tick.
          `backfaceVisibility: hidden` is a belt-and-suspenders hint for
          the same promotion. */}
      <div
        ref={worldRef}
        className="absolute inset-0"
        style={{
          // transform is applied by useLayoutEffect + applyCameraDirect,
          // NOT by JSX — this prevents React re-renders from overwriting
          // the gesture camera with stale state.camera.
          transformOrigin: "0 0",
          willChange: "transform",
          backfaceVisibility: "hidden",
        }}
      >
        {/* Grid inside world layer — transforms with panels so no drift.
            Adaptive: as the user zooms out, the grid cell size doubles so
            the screen-pixel spacing stays ≥80px. This keeps the line count
            manageable and prevents GPU rasterization stutter during fast
            pan/zoom at low zoom levels. */}
        <WorldContents
          zoom={zoom}
          panels={state.panels}
          selectedPanelIds={state.selectedPanelIds}
          dispatch={dispatch}
        />
      </div>

      {/* Cluster header tabs now rendered inside ClusterWorldLayer. */}

      {/* Floating selection menu — follows cursor when 2+ panels selected */}
      {cursorPos && state.selectedPanelIds.length >= 2 && (
        <SelectionMenu cursorPos={cursorPos} />
      )}

      {/* Marquee selection overlay — uses fixed positioning to escape the
          GPU-composited world layer (will-change:transform creates its own
          stacking context that paints over absolute-positioned siblings).
          Coordinates are already viewport-relative so fixed works directly. */}
      {marqueeRect && (marqueeRect.width > 0 || marqueeRect.height > 0) && (
        <div
          className="pointer-events-none rounded-[2px]"
          style={{
            position: "fixed",
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
            zIndex: 99998,
            border: "1px solid rgba(255, 255, 255, 0.35)",
            background: "rgba(255, 255, 255, 0.06)",
            boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.25)",
          }}
        />
      )}

      {/* Minimap — bird's-eye view of all panels + viewport indicator */}
      {showMinimap && vpSize.w > 0 && (
        <CanvasMinimap
          viewportWidth={vpSize.w}
          viewportHeight={vpSize.h}
        />
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMergeScheduler } from "@/shared/lib/merge-scheduler";
import { createPersistGate } from "@/shared/lib/persist-gate";
import { pruneLayout, resolvePositions } from "./positions";
import type { GraphLayout, NodeLayout, Point } from "./types";

const DEFAULT_DEBOUNCE_MS = 800;
// The whole layout persists under one key — each move merges into it and a
// single debounced write flushes the full map (the column stores one blob).
const PERSIST_KEY = "layout";

export interface UseGraphPositionsParams {
  /** Positions from the domain auto-layout (id → {x,y,width}). */
  autoPositions: Record<string, NodeLayout>;
  /** Server-persisted dragged positions (the `layout` column). */
  storedLayout?: GraphLayout | null;
  /** Writes the full layout map to the server. Debounced by this hook. */
  persist: (layout: GraphLayout) => Promise<void>;
  /** Debounce window for the persist write (default 800ms). */
  debounceMs?: number;
}

export interface UseGraphPositions {
  /** Effective positions: a stored/dragged position wins, else auto. */
  positions: Record<string, NodeLayout>;
  /** Optimistically move a node and schedule a debounced persist. */
  moveNode: (id: string, position: Point) => void;
  /** Clear all stored positions → back to pure auto-layout (persists `{}`). */
  resetLayout: () => void;
  /** Force the pending persist out now (also runs on unmount). */
  flush: () => Promise<void>;
  /** Ids with a stored/dragged position that still maps to a live node. */
  dirty: Record<string, boolean>;
}

/**
 * The hybrid-layout resolver + persistence bridge shared by the ontology
 * graphs. It merges the domain auto-layout with the user's
 * dragged positions (stored wins per node), exposes `moveNode` for
 * optimistic drags, and debounces the server write through the shared
 * merge-scheduler (flush-on-unmount, so a drag inside the window survives
 * navigating away). `resetLayout` drops back to pure auto-layout. A server
 * refetch is adopted only while no local edit is pending AND no persist is
 * in flight, so it never clobbers a drag mid-flight (the merge-scheduler
 * deletes its pending key before awaiting, so the in-flight PATCH is tracked
 * separately by a persist gate).
 */
export function useGraphPositions({
  autoPositions,
  storedLayout,
  persist,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseGraphPositionsParams): UseGraphPositions {
  const schedulerRef = useRef<ReturnType<typeof createMergeScheduler> | null>(null);
  const scheduler = (schedulerRef.current ??= createMergeScheduler(debounceMs));
  // Tracks the actual persist call while it's in flight — the scheduler frees
  // its pending key the moment the runner fires, so without this the idle
  // guard (and resetLayout ordering) would be blind to a landing PATCH.
  const gateRef = useRef<ReturnType<typeof createPersistGate> | null>(null);
  const gate = (gateRef.current ??= createPersistGate());

  const [overrides, setOverrides] = useState<GraphLayout>(() => storedLayout ?? {});
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  const persistRef = useRef(persist);
  persistRef.current = persist;

  // Latest auto-layout, read at persist/adopt time so orphan pruning always
  // sees the live node set without re-subscribing the callbacks.
  const autoPositionsRef = useRef(autoPositions);
  autoPositionsRef.current = autoPositions;

  // Adopt a fresh server layout only when idle — a pending drag write (queued
  // OR in flight) owns the positions until it settles. Orphans (ids no longer
  // in the auto layout) are pruned on adopt so they can't linger. Seeds
  // overrides on mount and on workspace/entity switch.
  useEffect(() => {
    if (scheduler.pendingKeys().length > 0 || gate.busy()) return;
    const raw = storedLayout ?? {};
    const auto = autoPositionsRef.current;
    // Skip pruning when the auto layout hasn't landed yet (transient empty
    // scene) so a valid stored layout isn't dropped before its nodes appear.
    const next = Object.keys(auto).length > 0 ? pruneLayout(raw, auto) : raw;
    overridesRef.current = next;
    setOverrides(next);
  }, [storedLayout, scheduler, gate]);

  // Flush pending drags on unmount so a move inside the debounce window lands.
  useEffect(() => {
    return () => {
      void scheduler.flushAll();
    };
  }, [scheduler]);

  const schedulePersist = useCallback(() => {
    scheduler.schedule(PERSIST_KEY, {}, () =>
      gate
        .run(() =>
          persistRef.current(pruneLayout(overridesRef.current, autoPositionsRef.current))
        )
        .catch(() => undefined)
    );
  }, [scheduler, gate]);

  const moveNode = useCallback(
    (id: string, position: Point) => {
      setOverrides((prev) => {
        const next = { ...prev, [id]: { x: position.x, y: position.y } };
        overridesRef.current = next;
        return next;
      });
      schedulePersist();
    },
    [schedulePersist]
  );

  const resetLayout = useCallback(() => {
    scheduler.cancel(PERSIST_KEY);
    overridesRef.current = {};
    setOverrides({});
    // Serialize the empty-`{}` reset strictly after any drag write already in
    // flight — the server treats `{}` as a replace (not a merge), so a late
    // drag PATCH landing after it would otherwise resurrect a dragged card.
    void gate
      .idle()
      .then(() => gate.run(() => persistRef.current({}).catch(() => undefined)));
  }, [scheduler, gate]);

  const flush = useCallback(() => scheduler.flush(PERSIST_KEY), [scheduler]);

  const positions = useMemo(
    () => resolvePositions(autoPositions, overrides),
    [autoPositions, overrides]
  );

  const dirty = useMemo(() => {
    const out: Record<string, boolean> = {};
    // Only count overrides that still map to a live node — an orphan (deleted
    // node) must not light up the Reset-layout button.
    for (const id of Object.keys(overrides)) if (autoPositions[id]) out[id] = true;
    return out;
  }, [overrides, autoPositions]);

  return { positions, moveNode, resetLayout, flush, dirty };
}

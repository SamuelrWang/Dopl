"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMergeScheduler } from "@/shared/lib/merge-scheduler";
import { createPersistGate } from "@/shared/lib/persist-gate";
import { pruneLayout, resolvePositions } from "./positions";
import type { GraphLayout, NodeLayout, Point } from "./types";

const DEFAULT_DEBOUNCE_MS = 800;
// One key for the whole layout: the column stores one blob, so each move
// merges in and a single debounced write flushes the full map.
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
  /** Clear stored positions → pure auto-layout (persists `{}`). */
  resetLayout: () => void;
  /** Force the pending persist out now (also runs on unmount). */
  flush: () => Promise<void>;
  /** Ids with a stored/dragged position that still maps to a live node. */
  dirty: Record<string, boolean>;
}

/**
 * Hybrid-layout resolver + persistence bridge. Auto-layout merged with the
 * user's dragged positions (stored wins per node); `moveNode` optimistic;
 * server write debounced via the shared merge-scheduler, flushed on unmount.
 * ⚠ A server refetch is adopted only when no local edit is pending AND no
 * persist is in flight — the merge-scheduler frees its pending key before
 * awaiting, so the in-flight PATCH needs the separate persist gate.
 */
export function useGraphPositions({
  autoPositions,
  storedLayout,
  persist,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseGraphPositionsParams): UseGraphPositions {
  const schedulerRef = useRef<ReturnType<typeof createMergeScheduler> | null>(null);
  const scheduler = (schedulerRef.current ??= createMergeScheduler(debounceMs));
  // Tracks the in-flight persist: the scheduler frees its pending key when the
  // runner fires, blinding the idle guard + resetLayout ordering without this.
  const gateRef = useRef<ReturnType<typeof createPersistGate> | null>(null);
  const gate = (gateRef.current ??= createPersistGate());

  const [overrides, setOverrides] = useState<GraphLayout>(() => storedLayout ?? {});
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  const persistRef = useRef(persist);
  persistRef.current = persist;

  // Read at persist/adopt time so orphan pruning sees the live node set
  // without re-subscribing the callbacks.
  const autoPositionsRef = useRef(autoPositions);
  autoPositionsRef.current = autoPositions;

  // Adopt a server layout only when idle — a pending drag write (queued OR in
  // flight) owns positions until it settles. Prunes orphans; also seeds
  // overrides on mount and on workspace/entity switch.
  useEffect(() => {
    if (scheduler.pendingKeys().length > 0 || gate.busy()) return;
    const raw = storedLayout ?? {};
    const auto = autoPositionsRef.current;
    // ⚠ Skip pruning while the auto layout is empty (transient) or a valid
    // stored layout is dropped before its nodes appear.
    const next = Object.keys(auto).length > 0 ? pruneLayout(raw, auto) : raw;
    overridesRef.current = next;
    setOverrides(next);
  }, [storedLayout, scheduler, gate]);

  // Flush on unmount so a move inside the debounce window lands.
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
    // ⚠ Serialize the `{}` reset strictly after any in-flight drag write: the
    // server treats `{}` as replace, not merge, so a late drag PATCH landing
    // after it resurrects a dragged card.
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
    // Live nodes only — an orphan must not light up Reset-layout.
    for (const id of Object.keys(overrides)) if (autoPositions[id]) out[id] = true;
    return out;
  }, [overrides, autoPositions]);

  return { positions, moveNode, resetLayout, flush, dirty };
}

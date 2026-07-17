"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live per-node height measurement for graph cards. Both graph views need the
 * real rendered height of every node card so a text edit re-flows the layout
 * and re-routes edges immediately — the identical ResizeObserver block used to
 * live in each. `registerRef` is the card's `ref` callback (id → element);
 * heights update as cards resize, and a removed node's stale height is pruned
 * so it can't linger in the map.
 */
export function useMeasuredHeights(): {
  heights: Record<string, number>;
  registerRef: (id: string, el: HTMLElement | null) => void;
} {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const idByEl = useRef(new Map<Element, string>());
  const observerRef = useRef<ResizeObserver | null>(null);

  const registerRef = useCallback((id: string, el: HTMLElement | null) => {
    observerRef.current ??= new ResizeObserver((entries) => {
      setHeights((prev) => {
        let next: Record<string, number> | null = null;
        for (const entry of entries) {
          const nodeId = idByEl.current.get(entry.target);
          if (!nodeId || !(entry.target instanceof HTMLElement)) continue;
          const height = entry.target.offsetHeight;
          if (prev[nodeId] !== height) {
            next ??= { ...prev };
            next[nodeId] = height;
          }
        }
        return next ?? prev;
      });
    });
    if (el) {
      idByEl.current.set(el, id);
      observerRef.current.observe(el);
    } else {
      for (const [element, nodeId] of idByEl.current) {
        if (nodeId !== id) continue;
        observerRef.current.unobserve(element);
        idByEl.current.delete(element);
      }
      // Drop the removed node's stale height so it can't linger in the map.
      setHeights((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { heights, registerRef };
}

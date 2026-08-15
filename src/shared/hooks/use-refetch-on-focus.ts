"use client";

import { useEffect, useRef } from "react";

interface Options {
  /** Skip the refetch when true. ⚠ Use while the user has unsaved keystrokes —
   *  replacing editor content mid-typing clobbers in-progress edits. */
  skip?: () => boolean;
  /** Minimum interval between refetches; rapid focus events collapse to one. */
  minIntervalMs?: number;
  /** Defaults to true; pass false to disable the hook entirely. */
  enabled?: boolean;
}

/**
 * `refetch` on tab focus/visibility, gated by `skip()` and throttled by
 * `minIntervalMs`. ⚠ Listens to BOTH `visibilitychange` (cmd-tab,
 * back-grounding) and `focus` (click-into-window from an already-visible
 * window) — either alone is unreliable across platforms.
 */
export function useRefetchOnFocus(
  refetch: () => void | Promise<void>,
  opts: Options = {}
): void {
  const { skip, minIntervalMs = 2000, enabled = true } = opts;
  const lastFiredRef = useRef(0);
  const refetchRef = useRef(refetch);
  const skipRef = useRef(skip);

  useEffect(() => {
    refetchRef.current = refetch;
    skipRef.current = skip;
  });

  useEffect(() => {
    if (!enabled) return;
    function maybeFire() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      if (skipRef.current?.()) return;
      const now = Date.now();
      if (now - lastFiredRef.current < minIntervalMs) return;
      lastFiredRef.current = now;
      void refetchRef.current();
    }
    document.addEventListener("visibilitychange", maybeFire);
    window.addEventListener("focus", maybeFire);
    return () => {
      document.removeEventListener("visibilitychange", maybeFire);
      window.removeEventListener("focus", maybeFire);
    };
  }, [enabled, minIntervalMs]);
}

"use client";

import { useEffect, useRef } from "react";

interface Options {
  /**
   * Skip the refetch when this returns true. Use to suppress refresh
   * while the user has unsaved keystrokes — replacing editor content
   * mid-typing would clobber their in-progress edits.
   */
  skip?: () => boolean;
  /**
   * Minimum interval between refetches. Multiple focus events fired in
   * quick succession (e.g. quick alt-tab) collapse to one call.
   */
  minIntervalMs?: number;
  /** Defaults to true; pass false to disable the hook entirely. */
  enabled?: boolean;
}

/**
 * Calls `refetch` whenever the browser tab regains focus or visibility,
 * gated by `skip()` and throttled by `minIntervalMs`.
 *
 * Listens to both `visibilitychange` (covers cmd-tab and back-grounding)
 * and `focus` (covers click-into-window from another already-visible
 * window) so the cross-tab "I switched back, show me the latest" flow
 * is reliable on every platform.
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

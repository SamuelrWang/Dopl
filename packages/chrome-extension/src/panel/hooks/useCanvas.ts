/**
 * Canvas panels hook — read/add/remove entries from the canvas.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useBgMessage } from "./useBgMessage";
import { CANVAS_POLL_INTERVAL } from "@/shared/constants";
import type { CanvasPanel } from "@/shared/types";

export function useCanvas(enabled = true) {
  const { send } = useBgMessage();
  const [panels, setPanels] = useState<CanvasPanel[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const data = await send<CanvasPanel[]>({ type: "GET_CANVAS_PANELS" });
      setPanels(data);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [send]);

  // Initial load + polling
  useEffect(() => {
    if (!enabled) return;

    refresh();
    intervalRef.current = setInterval(refresh, CANVAS_POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [refresh, enabled]);

  const addToCanvas = useCallback(
    async (entryId: string) => {
      try {
        await send({ type: "ADD_CANVAS_PANEL", entryId });
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [send, refresh]
  );

  const removeFromCanvas = useCallback(
    async (entryId: string) => {
      try {
        await send({ type: "REMOVE_CANVAS_PANEL", entryId });
        setPanels((prev) => prev.filter((p) => p.entry_id !== entryId));
        return true;
      } catch {
        return false;
      }
    },
    [send]
  );

  return { panels, loading, refresh, addToCanvas, removeFromCanvas };
}

"use client";

import { useEffect, type RefObject } from "react";

/**
 * Dismissal behavior for floating UI (menus, popovers, pickers):
 * calls `onClose` on Escape or on a pointerdown outside `ref`. Attach
 * the ref to the floating element — or a wrapper that also contains
 * the trigger, so trigger clicks don't count as outside. Pass
 * `enabled: false` while hidden so no listeners are registered.
 */
export function useDismissable(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  { enabled = true }: { enabled?: boolean } = {}
): void {
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const el = ref.current;
      if (el && event.target instanceof Node && !el.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [ref, onClose, enabled]);
}

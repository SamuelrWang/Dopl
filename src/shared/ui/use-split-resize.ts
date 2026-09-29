"use client";

/**
 * THE DRAGGABLE-DIVIDER MECHANISM, ONCE — a column whose width the operator
 * drags, moved by ONE CSS variable written on the handle's PARENT.
 *
 * Extracted 2026-09-29 from `channels/components/use-info-resize.ts` (Samuel,
 * 2026-09-13) when the knowledge rail took the same bar (Samuel, 2026-09-29:
 * *"look at the channels page … that vertical black bar … Let's bring that
 * over"*). The channel info column and the knowledge file rail are two CONFIGS of
 * this hook, never two copies of it; the view is `./split-resize-handle.tsx`.
 *
 * ⚠ **THE ROOT IS FOUND, NOT PASSED.** The handle's wrapper is a DIRECT CHILD of
 * the row holding both columns, so `parentElement` is that row on every host and
 * the variable written there reaches both columns. One imperative write per
 * pointer move, no render of the column, and nothing about the width is rendered
 * into HTML (so no hydration mismatch on the web).
 *
 * ⚠ **`side` IS WHICH SIDE OF THE HANDLE THE RESIZED COLUMN IS ON.** `"right"`
 * (the channel info column) grows LEFTWARD off the row's right edge, so the width
 * is `right − x` and ArrowLeft widens it; `"left"` (the knowledge rail) grows
 * RIGHTWARD off the row's left edge, so the width is `x − left` and ArrowRight
 * widens it. Either way the arrow moves the divider the way it points.
 *
 * ⚠ **THE PREFERENCE AND THE APPLIED WIDTH ARE TWO NUMBERS.** A narrow window
 * clamps what is APPLIED without overwriting what was CHOSEN, or one resize down
 * to a small window would silently spend the operator's pick.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

export interface SplitResizeConfig {
  /** The CSS variable every consumer reads, fallback stated at each consumer. */
  variable: string;
  /** Per-DEVICE localStorage key — a window's proportions belong to its screen. */
  storageKey: string;
  /** The width before any preference exists. */
  defaultWidth: number;
  /** The floor. */
  min: number;
  /** The ceiling for a row this wide — floored at `min` by {@link splitMax}. */
  max: (rowWidth: number) => number;
  /** Which side of the handle the resized column sits on (see docblock). */
  side: "left" | "right";
  /** Set on the row WHILE DRAGGING, so width transitions can stand down. */
  resizingAttr: string;
  /** One arrow-key press, in px. */
  nudgePx: number;
}

/** The ceiling, never below the floor — a row too narrow for any range has
 *  none rather than an inverted one. */
export function splitMax(config: SplitResizeConfig, rowWidth: number): number {
  return Math.max(config.min, Math.round(config.max(rowWidth)));
}

export function clampSplitWidth(
  config: SplitResizeConfig,
  width: number,
  rowWidth: number
): number {
  if (!Number.isFinite(width)) return config.defaultWidth;
  const max = splitMax(config, rowWidth);
  return Math.min(Math.max(Math.round(width), config.min), max);
}

/** ⚠ `null` FOR "NOTHING STORED", never a silent default: the caller clamps
 *  against a row width this function cannot see. Storage throws in a private
 *  window and is absent under SSR — both are "no preference". */
export function readStoredSplitWidth(storageKey: string): number | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function storeSplitWidth(storageKey: string, width: number): void {
  try {
    window.localStorage.setItem(storageKey, String(width));
  } catch {
    // A device that cannot remember still resizes.
  }
}

export interface SplitResize {
  /** The APPLIED width — `aria-valuenow`. */
  width: number;
  /** `aria-valuemin`. */
  min: number;
  /** `aria-valuemax` — remeasured on every write. */
  max: number;
  dragging: boolean;
  /** Ref for the handle's WRAPPER, whose parent is the row. */
  attach: (el: HTMLElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

/** `config` must be a module-level constant: its identity is a dependency. */
export function useSplitResize(config: SplitResizeConfig): SplitResize {
  const rootRef = useRef<HTMLElement | null>(null);
  /** What the operator CHOSE — see the docblock's two-numbers note. */
  const preferredRef = useRef(config.defaultWidth);
  /** What is APPLIED right now, so a pointer move needs no render to read it. */
  const appliedRef = useRef(config.defaultWidth);
  const [width, setWidth] = useState(config.defaultWidth);
  const [max, setMax] = useState(config.defaultWidth);
  const [dragging, setDragging] = useState(false);

  const write = useCallback(
    (next: number, opts?: { persist?: boolean; remember?: boolean }) => {
      const root = rootRef.current;
      if (!root) return;
      const row = root.getBoundingClientRect().width;
      if (opts?.remember !== false) preferredRef.current = next;
      const clamped = clampSplitWidth(config, next, row);
      appliedRef.current = clamped;
      root.style.setProperty(config.variable, `${clamped}px`);
      setWidth(clamped);
      setMax(splitMax(config, row));
      if (opts?.persist) storeSplitWidth(config.storageKey, clamped);
    },
    [config]
  );

  // ⚠ A REF CALLBACK, NOT AN EFFECT: it runs in the COMMIT, before paint, so a
  // remembered width never flashes at the default and then slides.
  const attach = useCallback(
    (el: HTMLElement | null) => {
      rootRef.current = el?.parentElement ?? null;
      if (!rootRef.current) return;
      write(readStoredSplitWidth(config.storageKey) ?? config.defaultWidth, {
        persist: false,
      });
    },
    [write, config]
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const root = rootRef.current;
      const strip = event.currentTarget;
      if (!root) return;
      // Stops the text selection a drag across the neighbour would otherwise make.
      event.preventDefault();
      // ⚠ CAPTURE, so the pointer may leave the 12px strip and still reach it.
      // Optional-called: jsdom has no such method.
      strip.setPointerCapture?.(event.pointerId);
      root.setAttribute(config.resizingAttr, "true");
      setDragging(true);
      // ⚠ READ THE ANCHORED EDGE ONCE — it cannot move during the drag, and
      // re-reading per move is a forced reflow.
      const rect = root.getBoundingClientRect();
      const onMove = (moveEvent: PointerEvent) => {
        write(
          config.side === "right"
            ? rect.right - moveEvent.clientX
            : moveEvent.clientX - rect.left
        );
      };
      const onUp = () => {
        strip.removeEventListener("pointermove", onMove);
        strip.removeEventListener("pointerup", onUp);
        strip.removeEventListener("pointercancel", onUp);
        try {
          strip.releasePointerCapture?.(event.pointerId);
        } catch {
          // Already released, or never captured.
        }
        root.removeAttribute(config.resizingAttr);
        setDragging(false);
        // ⚠ PERSIST ON RELEASE, not per move: a drag is ONE decision.
        storeSplitWidth(config.storageKey, appliedRef.current);
      };
      strip.addEventListener("pointermove", onMove);
      strip.addEventListener("pointerup", onUp);
      strip.addEventListener("pointercancel", onUp);
    },
    [write, config]
  );

  // The arrow moves the DIVIDER the way it points; whether that widens the
  // column depends on which side the column is on.
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const dir =
        event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (dir === 0) return;
      event.preventDefault();
      const grow = config.side === "right" ? -dir : dir;
      write(appliedRef.current + grow * config.nudgePx, { persist: true });
    },
    [write, config]
  );

  // ⚠ RE-CLAMP ON WINDOW RESIZE, AND DO NOT REMEMBER OR PERSIST IT — widening
  // again has to give the column back, which needs the CHOICE to survive.
  useEffect(() => {
    const onResize = () =>
      write(preferredRef.current, { persist: false, remember: false });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [write]);

  return {
    width,
    min: config.min,
    max,
    dragging,
    attach,
    onPointerDown,
    onKeyDown,
  };
}

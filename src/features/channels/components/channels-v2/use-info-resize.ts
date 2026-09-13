"use client";

/**
 * THE INFO COLUMN'S WIDTH IS THE OPERATOR'S (Samuel, 2026-09-13) — *"I should be
 * able to click on it and drag left and right to dynamically change the sizing
 * proportions of those two things."*
 *
 * ⚠ **IT MOVES ONE CSS VARIABLE, `--info-w`, AND IT WRITES IT ON THE SURFACE
 * ROOT.** Everything that has to follow the width READS that variable —
 * `.channel-info-slide`'s open width (globals.css + the desktop `kit.css` copy),
 * `info-panel.tsx`'s own `w-[…]`, and `agent-panel.tsx`'s overlay, which is
 * absolutely positioned against the SAME right edge and would otherwise make the
 * divider jump sideways the moment an agent view opens (the pairing that file
 * names in as many words). One imperative write per pointer move, no layout
 * thrash, and **nothing about the width is rendered into HTML** — which is also
 * why there is no hydration mismatch to answer for on the web.
 *
 * ⚠ **THE ROOT IS FOUND, NOT PASSED, AND THAT IS WHAT KEEPS THIS TO ONE
 * IMPLEMENTATION.** `channel-surface.tsx` is a FRAGMENT by construction (two flex
 * siblings — its own docblock says why), so the handle's wrapper is a DIRECT CHILD
 * of whichever host mounted the surface: `channels-v2-core.tsx`'s `.page-float`
 * row on the workspace page, `channel-surface-standalone.tsx`'s row on the desktop
 * Home pane. `parentElement` is therefore the surface root on both, and neither
 * host needed an edit.
 *
 * ⚠ **THE LIMITS ARE SAMUEL'S, BOTH OF THEM, AND THEY ARE NOT SYMMETRIC.**
 * Dragging LEFT stops at half the surface — *"it should only go left so that the
 * right pane and the left pane are the same size"*. Dragging RIGHT stops at
 * {@link INFO_WIDTH_DEFAULT}, the width the column has always had — *"a max
 * distance thing so that it doesn't collapse too much"*. **The column never gets
 * narrower than it is today**, which is also why nothing inside it can break: the
 * only fixed width in the pane (`info-card-rows.tsx`'s `w-[150px]` value field)
 * was measured at 380 and this floor is 380. The transcript only ever SHRINKS, and
 * it already absorbs that (`message-pane.tsx › section` carries
 * `contain: inline-size`; §5).
 *
 * ⚠ **THE PREFERENCE AND THE APPLIED WIDTH ARE TWO NUMBERS.** A narrow window
 * clamps what is APPLIED without overwriting what was CHOSEN, or one resize down
 * to a small window would silently spend the operator's pick — widen again and the
 * column would stay where the clamp left it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

/** The variable every consumer reads. Its FALLBACK is {@link INFO_WIDTH_DEFAULT}
 *  stated at each consumer, so the column is correct before this hook ever runs. */
export const INFO_WIDTH_VAR = "--info-w";

/** Per DEVICE, not per channel and not per workspace — a window's proportions are
 *  a property of the screen it is on. */
export const INFO_WIDTH_STORAGE_KEY = "dopl.channel.infoWidth";

/** ⚠ TODAY'S WIDTH, AND IT IS BOTH THE DEFAULT AND THE MINIMUM. Paired with
 *  `.channel-info-slide[data-open="true"]`'s fallback and `agent-panel.tsx`'s —
 *  pinned on all three by `app-shell/frame-palette.test.ts`. */
export const INFO_WIDTH_DEFAULT = 380;

/** One arrow-key press. */
export const INFO_NUDGE_PX = 16;

/** Set on the surface root WHILE DRAGGING, so the 200ms width transition stands
 *  down and the column tracks the pointer instead of lagging it. The CSS half is
 *  `[data-info-resizing="true"] .channel-info-slide` in both kit copies. */
export const INFO_RESIZING_ATTR = "data-info-resizing";

/** 50/50 with the transcript, never below the floor — a surface too narrow to
 *  halve has no range at all rather than an inverted one. */
export function infoWidthMax(surfaceWidth: number): number {
  return Math.max(INFO_WIDTH_DEFAULT, Math.round(surfaceWidth / 2));
}

export function clampInfoWidth(width: number, surfaceWidth: number): number {
  if (!Number.isFinite(width)) return INFO_WIDTH_DEFAULT;
  const max = infoWidthMax(surfaceWidth);
  return Math.min(Math.max(Math.round(width), INFO_WIDTH_DEFAULT), max);
}

/** ⚠ `null` FOR "NOTHING STORED", never a silent {@link INFO_WIDTH_DEFAULT}: the
 *  caller clamps against a surface width this function cannot see. Storage throws
 *  in a private window and is absent under SSR — both are "no preference". */
export function readStoredInfoWidth(): number | null {
  try {
    const raw = window.localStorage.getItem(INFO_WIDTH_STORAGE_KEY);
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function storeInfoWidth(width: number): void {
  try {
    window.localStorage.setItem(INFO_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // A device that cannot remember still resizes.
  }
}

export interface InfoResize {
  /** The APPLIED width — `aria-valuenow`. */
  width: number;
  /** `aria-valuemin` — {@link INFO_WIDTH_DEFAULT}. */
  min: number;
  /** `aria-valuemax` — half the surface, remeasured on every write. */
  max: number;
  dragging: boolean;
  /** Ref for the handle's WRAPPER, whose parent is the surface root. */
  attach: (el: HTMLElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export function useInfoResize(): InfoResize {
  const rootRef = useRef<HTMLElement | null>(null);
  /** What the operator CHOSE — see the docblock's two-numbers note. */
  const preferredRef = useRef(INFO_WIDTH_DEFAULT);
  /** What is APPLIED right now, so a pointer move needs no render to read it. */
  const appliedRef = useRef(INFO_WIDTH_DEFAULT);
  const [width, setWidth] = useState(INFO_WIDTH_DEFAULT);
  const [max, setMax] = useState(INFO_WIDTH_DEFAULT);
  const [dragging, setDragging] = useState(false);

  const write = useCallback(
    (next: number, opts?: { persist?: boolean; remember?: boolean }) => {
      const root = rootRef.current;
      if (!root) return;
      const surface = root.getBoundingClientRect().width;
      if (opts?.remember !== false) preferredRef.current = next;
      const clamped = clampInfoWidth(next, surface);
      appliedRef.current = clamped;
      root.style.setProperty(INFO_WIDTH_VAR, `${clamped}px`);
      setWidth(clamped);
      setMax(infoWidthMax(surface));
      if (opts?.persist) storeInfoWidth(clamped);
    },
    []
  );

  // ⚠ A REF CALLBACK, NOT AN EFFECT, and the timing is the reason: it runs in the
  // COMMIT, before paint, so a remembered 520px column never flashes at 380 and
  // then slides — the shell carries a 200ms width transition that would animate
  // exactly that. Stable identity (`write` is), so React does not re-attach.
  const attach = useCallback(
    (el: HTMLElement | null) => {
      rootRef.current = el?.parentElement ?? null;
      if (!rootRef.current) return;
      write(readStoredInfoWidth() ?? INFO_WIDTH_DEFAULT, { persist: false });
    },
    [write]
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const root = rootRef.current;
      const strip = event.currentTarget;
      if (!root) return;
      // Stops the text selection a drag across the transcript would otherwise make.
      event.preventDefault();
      // ⚠ CAPTURE, so the pointer may leave the 12px strip — which it does
      // immediately — and still reach it. Optional-called: jsdom has no such method.
      strip.setPointerCapture?.(event.pointerId);
      root.setAttribute(INFO_RESIZING_ATTR, "true");
      setDragging(true);
      // ⚠ READ THE RIGHT EDGE ONCE. It cannot move during the drag (the column
      // grows leftward off it), and re-reading per move is a forced reflow.
      const right = root.getBoundingClientRect().right;
      const onMove = (moveEvent: PointerEvent) => {
        write(right - moveEvent.clientX);
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
        root.removeAttribute(INFO_RESIZING_ATTR);
        setDragging(false);
        // ⚠ PERSIST ON RELEASE, not per move: a drag is ONE decision, and a
        // write per frame is a storage write per frame.
        storeInfoWidth(appliedRef.current);
      };
      strip.addEventListener("pointermove", onMove);
      strip.addEventListener("pointerup", onUp);
      strip.addEventListener("pointercancel", onUp);
    },
    [write]
  );

  // ⚠ LEFT WIDENS, matching the drag: the column grows leftward, so the arrow
  // that moves the divider left is the one that makes the info pane bigger.
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const delta =
        event.key === "ArrowLeft"
          ? INFO_NUDGE_PX
          : event.key === "ArrowRight"
            ? -INFO_NUDGE_PX
            : 0;
      if (delta === 0) return;
      event.preventDefault();
      write(appliedRef.current + delta, { persist: true });
    },
    [write]
  );

  // ⚠ RE-CLAMP, AND DO NOT REMEMBER OR PERSIST IT. A window narrowed past twice
  // the chosen width has to give the pane back, and widening again has to give it
  // back — which is only possible while the CHOICE survives the clamp.
  useEffect(() => {
    const onResize = () =>
      write(preferredRef.current, { persist: false, remember: false });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [write]);

  return {
    width,
    min: INFO_WIDTH_DEFAULT,
    max,
    dragging,
    attach,
    onPointerDown,
    onKeyDown,
  };
}

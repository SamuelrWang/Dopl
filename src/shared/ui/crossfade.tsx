"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/** Out, then in. ⚠ Keep in sync with the kit's `.crossfade` transition
 *  (globals.css + the desktop `kit.css` copy). */
const FADE_MS = 150;

/** Read at event time, not subscribed: it only gates whether a swap waits. */
function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * THE CONTENT SWAP — one surface whose CONTENTS change: fade out, replace, fade
 * in, with the frame and the control that drove it staying exactly where they
 * are (Samuel, 2026-08-24). /home's record pane switching conversations and the
 * channel info column switching tabs are the same gesture and use this.
 *
 * ⚠ IT TAKES A RENDER FUNCTION, NOT CHILDREN, and that is the whole design.
 * React hands a parent's `children` over the instant the selection changes, so
 * fading LIVE children fades out the thing you just picked and fades the same
 * thing back in. Handing the caller the token that is ON SCREEN — which lags the
 * page by exactly one fade — makes the outgoing view a pure function of a value
 * instead of a stale tree to be held: no ref read during render (which
 * `react-hooks/refs` forbids), and nothing that can go out of sync.
 *
 * ⚠ IT IS NOT A DEBOUNCE. Props for the token ALREADY shown pass straight
 * through, unfaded — a message landing in the open transcript, or a count
 * ticking on the tab you are looking at, must not blink the surface. Only a
 * TOKEN change is a swap.
 *
 * ⚠ THE OUTGOING VIEW IS STILL MOUNTED FOR THE FADE. Do not use this where the
 * old subtree must tear down immediately (a permission drop, a deleted row) —
 * it stays for 150ms, doing whatever it does.
 *
 * ⚠ `prefers-reduced-motion` waits 0ms rather than taking a second code path,
 * and the kit disables the transition under the same query, so nothing fades.
 */
export function Crossfade({
  token,
  className,
  children,
}: {
  /** Identity of what should be shown. A CHANGE is what triggers a swap. */
  token: string;
  /** Layout only — the fade itself is the kit's `.crossfade`. */
  className?: string;
  /** Renders the view for the token currently ON SCREEN, not for `token`. */
  children: (shownToken: string) => ReactNode;
}) {
  const [shownToken, setShownToken] = useState(token);
  // Fading out IS "the caller moved on and this has not caught up" — derived,
  // never stored, so the two can never disagree.
  const settled = token === shownToken;

  // ⚠ THE ONLY setState IS INSIDE THE TIMER: `react-hooks/set-state-in-effect`
  // is an error in this repo, so the effect body may not swap synchronously.
  useEffect(() => {
    if (settled) return;
    const timer = setTimeout(
      () => setShownToken(token),
      prefersReducedMotion() ? 0 : FADE_MS
    );
    return () => clearTimeout(timer);
  }, [settled, token]);

  return (
    <div
      className={cn("crossfade", className)}
      data-out={settled ? undefined : ""}
      aria-busy={settled ? undefined : true}
    >
      {children(shownToken)}
    </div>
  );
}

"use client";

/**
 * **CROSS-FADE WHATEVER IS INSIDE WHEN THE VIEW CHANGES** (Samuel, 2026-09-20,
 * twice in one message: *"when I select a certain group, the inside of the
 * channel just immediately switches … I want there to be more animation in the
 * sense that the messages inside fade in and fade out to make it look less
 * choppy"*, and *"when I switch between artifact and thread views, the inside
 * panel should not switch so choppy. It should be fading out and fading in"*).
 *
 * ⚠ **ONE COMPONENT FOR BOTH BECAUSE IT IS ONE COMPLAINT.** The two surfaces are
 * unrelated in every other way — a transcript filtered by author, and a tab body
 * swapping between two lists — and the thing that reads as choppy is identical:
 * the content under a control is replaced between one frame and the next. A
 * second implementation would be two durations and two easings for one motion.
 *
 * 🔒 **IT NEVER HOLDS STALE CONTENT, AND THAT RULED OUT THE OBVIOUS BUILD.** The
 * first version faded OUT over 120ms, swapped at the trough and faded in — which
 * meant the previous view was still on screen after the state had moved on. Two
 * things break on that: a realtime message arriving mid-fade is invisible until
 * the timer fires, and every test that clicks a filter and asserts is racing an
 * animation. So the swap is a REMOUNT — `key={viewKey}` — and the only motion is
 * the new tree fading up from nothing. What a reader sees is still out-then-in,
 * because the old tree is gone the instant the new one mounts.
 *
 * ⚠ **`viewKey` IS THE WHOLE API AND IT MUST NAME THE VIEW, NEVER THE DATA.** A
 * key that moves when a message arrives would remount the transcript on every
 * realtime push — the opposite of what was asked, and a scroll jump besides.
 * Callers pass the FILTER or the FACE: the thing the operator just changed.
 *
 * ⚠ **THE ANIMATION IS A CSS CLASS, NOT A TIMER.** `.fade-swap-in` lives in the
 * two stylesheets (`app/globals.css` and the desktop `styles/kit.css`, held
 * together by `scripts/check-css-token-drift.ts`), so it is turned off under
 * `prefers-reduced-motion` by the same rule every other motion in the app obeys —
 * and there is no JavaScript branch here that could disagree with it.
 */

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

export function FadeSwap({
  viewKey,
  className,
  children,
}: {
  /** WHICH VIEW this is — a filter id, a face name. ⚠ Never a data hash. */
  viewKey: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      // ⚠ **THE `key` IS THE MECHANISM.** React unmounts the old subtree and
      // mounts a new one, so the CSS animation below replays; without it the
      // class sits on a long-lived element and never runs a second time.
      key={viewKey}
      data-fade-swap={viewKey}
      className={cn("fade-swap-in", className)}
    >
      {children}
    </div>
  );
}

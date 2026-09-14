"use client";

/**
 * "Open as new window" — the thread view's POP-OUT affordance (wiring plan Phase 10,
 * 2026-08-18).
 *
 * ⚠ DESKTOP-ONLY, BY FEATURE DETECTION AND NOTHING ELSE. `getDesktopThreadWindows()`
 * answers null in a plain browser and against any desktop build whose preload predates
 * this op, and this component then renders NOTHING. That is the tree's standing rule for
 * a bridge capability (INVARIANTS §11) — never a disabled button, never a browser-side
 * fallback that opens a tab, because a second tab is not a second window and would quietly
 * become a different feature.
 *
 * ⚠ THE READ IS `useSyncExternalStore`, NOT A RENDER-TIME READ AND NOT AN EFFECT. The bridge
 * is a WINDOW GLOBAL: reading it while rendering makes the server and the first client
 * render disagree (the standing rule `use-desktop-sessions.ts › useDesktopSessions` states), and
 * setting state synchronously inside an effect is a `react-hooks/set-state-in-effect` ERROR
 * in this tree, not a preference. `useSyncExternalStore` is the shape React provides for
 * exactly this: a server snapshot of `false` (no bridge exists there), a client snapshot
 * that asks the preload, and no subscription — the preload's surface is fixed for the life
 * of the document, so there is nothing to change.
 *
 * ⚠ THE SEGMENT IS `workspaceSlug`, the canonical `{slug}-{publicId}` value every link in
 * this tree is built from — the same string main interpolates for a notification's landing
 * route. Main re-checks it (and the thread id) against `deep-link-target.js › isSafeSegment`
 * and the channel id as a UUID; nothing here is trusted on the other side.
 *
 * ⚠ FIRE AND FORGET. The answer is `{ ok }` and there is deliberately nothing to do with a
 * false: main refuses a bad id, a blocking version floor and a full window budget in the
 * same shape, so there is no honest sentence to show — and it already said which in its own
 * log. A rejected promise must not surface as an unhandled rejection in a header.
 */

import { useSyncExternalStore } from "react";
import { ExternalLink } from "lucide-react";
import { getDesktopThreadWindows } from "@/shared/lib/desktop";
import { IconButton } from "./bits";

/** The button's accessible name — the ONE spelling, asserted by `pop-out.test.tsx`. */
export const POP_OUT_THREAD_LABEL = "Open as new window";

// A preload's surface is fixed for the life of the document, so there is nothing to
// subscribe to; the unsubscribe is what `useSyncExternalStore` wants back.
const noSubscribe = () => () => {};
const hasBridge = () => getDesktopThreadWindows() !== null;
const noBridgeOnServer = () => false;

export function PopOutThreadButton({
  workspaceSlug,
  channelId,
  threadId,
}: {
  workspaceSlug: string;
  channelId: string;
  threadId: string;
}) {
  const available = useSyncExternalStore(noSubscribe, hasBridge, noBridgeOnServer);

  if (!available) return null;

  return (
    // ⚠ NO SIZE OVERRIDE. It sits immediately left of the info toggle and must
    // wear the SAME face (Samuel, 2026-08-19); it carried a 14px glyph while it
    // lived beside the crumb, which reads as a smaller button next to the ⓘ.
    <IconButton
      icon={ExternalLink}
      label={POP_OUT_THREAD_LABEL}
      onClick={() => {
        const bridge = getDesktopThreadWindows();
        if (!bridge) return;
        void bridge.openWindow(workspaceSlug, channelId, threadId).catch(() => {
          // Main logged the refusal. There is nothing honest to say here.
        });
      }}
    />
  );
}

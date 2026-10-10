"use client";

import { useEffect } from "react";
import { getSpaBridge } from "@/shared/lib/spa-bridge";
import { toast } from "@/shared/ui/toast";

/**
 * THE RENDERER END OF THE "MAC + POPUP" SPLIT (2026-10-09, KB dopl-development "Notification Spec
 * Samuel 2026-10-09" › Build order step 2).
 *
 * Samuel's spec marks 9 events for Mac + popup. An OS banner is raised in Electron main; a toast
 * lives in this renderer. Firing both would announce one fact twice at the same desk, so main
 * resolves it at raise time (`main/notification-route.js`): Dopl in front → it pushes here
 * instead of raising a banner. This component is what makes that push visible, and without it
 * every "in front" case would be silently dropped.
 *
 * ⚠ RENDERS NOTHING. Mount it once, beside `ToastHost`.
 * ⚠ DESKTOP ONLY, BY CAPABILITY not by truthiness: the web tree has no main process to push, and
 * an older desktop has a `window.dopl` carrying everything but this op (the
 * `use-orchestrator-launch.ts` rule). Both cases are a silent, harmless no-op.
 * ⚠ THE OPERATOR'S PREFERENCE IS ALREADY APPLIED. Main runs the gate before pushing, so this
 * file does not re-check it — and must not, or a stale renderer copy could mute something the
 * account record says is on.
 * ⚠ `variant: "invert"` is the incoming face (the small black toast), which renders the title
 * only. That matches the single string main sends.
 */
/**
 * "Until it is answered", expressed as a duration because that is what the toast host takes.
 * ⚠ NOT `Infinity` AND NOT A HUGE NUMBER: `setTimeout` clamps above 2^31-1 ms and fires
 * IMMEDIATELY on overflow, which would make a sticky toast the most fleeting one of all. A day is
 * far longer than any session the operator is deciding about, and safely inside the limit.
 */
const STICKY_MS = 24 * 60 * 60 * 1000;

export function IncomingToasts() {
  useEffect(() => {
    const bridge = getSpaBridge()?.notifications;
    if (typeof bridge?.onToast !== "function") return;
    let off: (() => void) | undefined;
    try {
      off = bridge.onToast((t) => {
        // A push with no title is nothing to show; main already refuses to send one, so this is
        // belt-and-braces against a future shape change.
        if (!t.title) return;
        // An ACTIONABLE event raised while Dopl is in front: one button, and it only NAVIGATES to
        // the surface that answers the thing (the thread's send box, the launch control). The
        // affirmative — "Launch agent" / "Send" / "Allow" — stays on the OS banner, because a
        // toast auto-dismisses and a dismissal decides nothing.
        if (t.openId && t.actionLabel) {
          const openId = t.openId;
          toast({
            title: t.title,
            description: t.body || undefined,
            action: {
              label: t.actionLabel,
              onClick: () => {
                void getSpaBridge()?.notifications?.openFromToast?.(openId)?.catch(() => {});
              },
            },
            // Longer than the default: these are worth reaching, and they still decide nothing if
            // missed. A STICKY one waits indefinitely — the resume offer is raised once, at
            // startup, so a four-second window would simply lose it.
            durationMs: t.sticky ? STICKY_MS : 15000,
          });
          return;
        }
        toast({ title: t.title, variant: "invert" });
      });
    } catch {
      // A subscribe that throws leaves the OS banner as the operator's only surface, which is
      // the safe direction and not worth failing a mount over.
      return;
    }
    return () => {
      try {
        off?.();
      } catch {
        /* unsubscribing a dead listener is not a failure worth reporting */
      }
    };
  }, []);
  return null;
}

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
 * ⚠ IT ACKS ON MOUNT, AND MAIN WAITS FOR THAT ACK. `webContents.send` does not throw into a
 * window whose renderer has not mounted this subscriber yet, so main used to count a push into an
 * unmounted window as DELIVERED — which silently lost the startup resume offer on every cold
 * start. Main now HOLDS a toast until this ack and falls back to the OS banner without it, so the
 * ack is load-bearing, not telemetry. It rides the existing navigation op with main's reserved
 * handle (`notification-route.js › TOAST_READY_ID`) rather than a new IPC surface.
 */

/** Main's reserved `openId`, meaning "my toast layer is mounted" rather than "open this". */
const TOAST_READY_ID = "toast-ready";

/**
 * "Until it is answered", expressed as a duration because that is what the toast host takes.
 * ⚠ NOT `Infinity` AND NOT A HUGE NUMBER: `setTimeout` clamps above 2^31-1 ms and fires
 * IMMEDIATELY on overflow, which would make a sticky toast the most fleeting one of all. A day is
 * far longer than any session the operator is deciding about, and safely inside the limit.
 */
const STICKY_MS = 24 * 60 * 60 * 1000;
/** An actionable toast is worth reaching for, and it still decides nothing if it is missed. */
const ACTIONABLE_MS = 15000;
/** The host's own auto-dismiss for the plain one-line face. Kept in step with `toast.tsx`. */
const PLAIN_MS = 4000;
/**
 * How long one toast owns the slot before the next queued one may take it. A sticky toast is not
 * allowed to own it for its full day: it would starve every mention behind it.
 */
const MAX_SLOT_MS = ACTIONABLE_MS;
/**
 * ⚠ BOUNDED. Unbounded growth is a shape this tree has been bitten by, and a notification backlog
 * is the least useful thing to keep: the OLDEST goes first, because the newest news is the news.
 * Nothing is lost by dropping one — the thread and the Tags inbox hold every mention either way.
 */
const MAX_QUEUED = 8;

type IncomingToast = {
  eventId: string;
  title: string;
  body?: string;
  openId?: string;
  actionLabel?: string;
  sticky?: boolean;
  kind: "incoming";
};

export function IncomingToasts() {
  useEffect(() => {
    const bridge = getSpaBridge()?.notifications;
    if (typeof bridge?.onToast !== "function") return;

    /**
     * ⚠ THE `kind: 'incoming'` YIELD CONTRACT, IMPLEMENTED. The host holds ONE toast
     * (`toast.tsx › currentToast`), so before this queue every push overwrote whatever was on
     * screen: two mentions arriving inside one 4-second life showed as ONE, and the second
     * silently replaced the first. Each incoming toast now gets its own visible life, in order.
     */
    const queue: IncomingToast[] = [];
    let slotTimer: ReturnType<typeof setTimeout> | undefined;
    let showing = false;
    let live = true;

    const lifeOf = (t: IncomingToast) => {
      if (t.sticky) return STICKY_MS;
      return t.openId && t.actionLabel ? ACTIONABLE_MS : PLAIN_MS;
    };

    function show(t: IncomingToast) {
      if (t.openId && t.actionLabel) {
        const openId = t.openId;
        toast({
          title: t.title,
          description: t.body || undefined,
          action: {
            label: t.actionLabel,
            // An ACTIONABLE event raised while Dopl is in front: one button, and it only
            // NAVIGATES to the surface that answers the thing (the thread's send box, the launch
            // control). The affirmative — "Launch agent" / "Send" / "Allow" — stays on the OS
            // banner, because a toast auto-dismisses and a dismissal decides nothing.
            onClick: () => {
              void getSpaBridge()?.notifications?.openFromToast?.(openId)?.catch(() => {});
            },
          },
          // A STICKY one waits rather than expiring: the resume offer is raised once, at startup,
          // so a four-second window would simply lose it.
          durationMs: lifeOf(t),
        });
        return;
      }
      /**
       * 🔒 **THE PLAIN CARD IS CLICKABLE WHEN IT CARRIES A HANDLE** (Samuel, 2026-10-12, #4358
       * opt 1). A `mention` pushed while Dopl is in front used to render a card with nothing to
       * click, while the OS banner for the same event navigated to the message — so being at
       * your desk was the one state in which the notification could not be followed.
       *
       * ⚠ **`openId` WITHOUT `actionLabel` IS THE WHOLE DISTINCTION**, and the two branches above
       * already honour it: `lifeOf` gives this PLAIN_MS and `show` gives it the plain face. So a
       * burst of mentions is still 4s each and the single slot is untouched — no button, no 15s
       * hold. Nothing here special-cases the mention event; the shape of the push decides.
       * ⚠ **THE SAME ONE-SHOT OP AS THE BUTTON**, so a press after the card is gone is a no-op on
       * both sides: main drops the entry before running it, and the card has unmounted anyway.
       */
      const onBodyClick = t.openId
        ? () => {
            void getSpaBridge()?.notifications?.openFromToast?.(t.openId!)?.catch(() => {});
          }
        : undefined;
      // ⚠ THE FACE FOLLOWS THE COPY. `variant: "invert"` is the small black line and renders the
      // TITLE ONLY, so a push that carries a body (a mention's detail, `decision_failed`'s
      // recovery sentence, `tool_blocked`'s reason) takes the default card, which shows both.
      // ⚠ A title-only push with a handle takes the DEFAULT card too, not the black line: that
      // face carries no controls by design, so a click target on it would be invisible.
      if (t.body || onBodyClick) {
        toast({ title: t.title, description: t.body || undefined, onBodyClick, durationMs: PLAIN_MS });
      } else {
        toast({ title: t.title, variant: "invert" });
      }
    }

    function drain() {
      if (!live || showing) return;
      const next = queue.shift();
      if (!next) return;
      showing = true;
      show(next);
      slotTimer = setTimeout(() => {
        showing = false;
        drain();
      }, Math.min(lifeOf(next), MAX_SLOT_MS));
    }

    let off: (() => void) | undefined;
    try {
      off = bridge.onToast((t) => {
        // A push with no title is nothing to show; main already refuses to send one, so this is
        // belt-and-braces against a future shape change. ⚠ It must not reach the queue either:
        // a queued blank would cost a real toast its turn in the slot.
        if (!t.title) return;
        if (queue.length >= MAX_QUEUED) queue.shift();
        queue.push(t as IncomingToast);
        drain();
      });
    } catch {
      // A subscribe that throws leaves the OS banner as the operator's only surface, which is
      // the safe direction and not worth failing a mount over. No ack is sent: main must fall
      // back to the banner, not hold toasts for a listener that does not exist.
      return;
    }

    // ⚠ ONLY NOW, with the listener actually installed. Acking before `onToast` returned would
    // re-create the race this ack exists to close.
    void getSpaBridge()
      ?.notifications?.openFromToast?.(TOAST_READY_ID)
      ?.catch(() => {});

    return () => {
      live = false;
      if (slotTimer) clearTimeout(slotTimer);
      try {
        off?.();
      } catch {
        /* unsubscribing a dead listener is not a failure worth reporting */
      }
    };
  }, []);
  return null;
}

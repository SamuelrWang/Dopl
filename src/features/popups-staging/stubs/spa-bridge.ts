/**
 * STUB of `@/shared/lib/spa-bridge › getSpaBridge` for the staged `IncomingToasts` — only the
 * `notifications` pair it reads. `pushStagingToast` plays main: it sends a toast payload the way
 * `main/notification-route.js` does while Dopl is in front.
 */
import { toast } from "@/shared/ui/toast";

export interface StagingIncomingToast {
  eventId: string;
  title: string;
  body?: string;
  openId?: string;
  actionLabel?: string;
  sticky?: boolean;
}

const listeners = new Set<(t: StagingIncomingToast) => void>();

/** STAGING ONLY: who answers a toast's click (main's `openFromToast` route). The frame's popup
 *  provider registers one that opens the staged windows; it returns false for ids it does not
 *  own, and the fallback toast stands in. */
let toastOpener: ((openId: string) => boolean) | null = null;
export function setStagingToastOpener(opener: ((openId: string) => boolean) | null): void {
  toastOpener = opener;
}

const BRIDGE = {
  notifications: {
    onToast(listener: (t: StagingIncomingToast) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async openFromToast(openId: string) {
      if (openId === "toast-ready") return;
      if (toastOpener?.(openId)) return;
      toast({ title: `Staging: would open ${openId}`, variant: "invert" });
    },
  },
};

export function getSpaBridge() {
  return BRIDGE;
}

/** STAGING ONLY: push one toast as main would. */
export function pushStagingToast(t: StagingIncomingToast): void {
  for (const l of listeners) l(t);
}
